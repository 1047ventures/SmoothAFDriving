import { describe, it, expect, beforeEach } from 'vitest';
import { parseAtrv, createBatteryWatch, classify, batterySummary, saveBatteryReading, saveLastRun, loadBattery, moveBattery } from '../services/battery.js';

const HOUR = 3_600_000;

// Feed a sequence of voltages at a fixed interval; collect every reading emitted.
function run(watch, volts, { from = 10 * HOUR, every = 250, ignitionOff = true, rpm = null } = {}){
  const out = [];
  volts.forEach((v, i) => out.push(...watch.feed({ t: from + i * every, v, rpm, ignitionOff })));
  return out;
}
const rep = (v, n) => Array(n).fill(v);

describe('parseAtrv', () => {
  it('reads the adapter voltage reply', () => {
    expect(parseAtrv('12.6V\r\r>')).toBe(12.6);
    expect(parseAtrv('14.15V>')).toBe(14.15);
    expect(parseAtrv('?\r>')).toBeNull();
    expect(parseAtrv('')).toBeNull();
    expect(parseAtrv('0.2V')).toBeNull();
  });
});

describe('createBatteryWatch', () => {
  it('logs a resting reading with the ignition off and the engine cold', () => {
    const w = createBatteryWatch({ lastRunAt: 0 });
    const out = run(w, rep(12.48, 12));
    expect(out).toEqual([{ kind: 'resting', v: 12.48, at: expect.any(Number) }]);
  });
  it('skips resting within an hour of the engine running (surface charge)', () => {
    const w = createBatteryWatch({ lastRunAt: 10 * HOUR - 20 * 60_000 });
    expect(run(w, rep(12.75, 12))).toEqual([]);
  });
  it('skips resting with the ignition on', () => {
    const w = createBatteryWatch();
    expect(run(w, rep(12.4, 12), { ignitionOff: false })).toEqual([]);
  });
  it('catches the crank dip, then a settled charging reading', () => {
    const w = createBatteryWatch();
    const crank = [...rep(12.5, 10), 10.8, 9.9, 10.4, 12.1, 13.9];
    const out = run(w, crank);
    expect(out.map(r => r.kind)).toEqual(['resting', 'crank']);
    expect(out[1].v).toBe(9.9);
    expect(w.mode).toBe('running');
    // A minute to settle at 1 Hz, then 30 samples of charging.
    const charging = run(w, rep(14.2, 100), { from: 10 * HOUR + 5000, every: 1000 });
    expect(charging).toEqual([{ kind: 'charging', v: 14.2, at: expect.any(Number) }]);
  });
  it('drops a crank it sampled too sparsely to trust', () => {
    const w = createBatteryWatch();
    const out = run(w, [12.5, 12.5, 12.5, 13.9], { every: 2000 });
    expect(out.some(r => r.kind === 'crank')).toBe(false);
  });
  it('drops a "crank" with no dip (we connected mid-start or missed it)', () => {
    const w = createBatteryWatch();
    const out = run(w, [...rep(12.5, 10), 13.9]);
    expect(out.some(r => r.kind === 'crank')).toBe(false);
  });
  it('starts in running mode when the engine is already on, and notices it stop', () => {
    const w = createBatteryWatch();
    run(w, [14.1, 14.1]);
    expect(w.mode).toBe('running');
    run(w, [12.6, 12.6, 12.6], { from: 11 * HOUR });
    expect(w.mode).toBe('off');
    expect(w.lastRunAt).toBeGreaterThan(10 * HOUR);
  });
});

describe('classify', () => {
  it('bands resting, starting and charging', () => {
    expect(classify('resting', 12.65).state).toBe('good');
    expect(classify('resting', 12.3).state).toBe('watch');
    expect(classify('resting', 12.0).state).toBe('bad');
    expect(classify('crank', 10.2).state).toBe('good');
    expect(classify('crank', 9.7).state).toBe('watch');
    expect(classify('crank', 9.2).state).toBe('bad');
    expect(classify('charging', 14.2).state).toBe('good');
    expect(classify('charging', 13.1).state).toBe('watch');
    expect(classify('charging', 12.4).state).toBe('bad');
    expect(classify('charging', 15.3).state).toBe('bad');
  });
});

describe('batterySummary', () => {
  const now = 100 * 86_400_000;
  it('scores the worst current reading and notes the voltages', () => {
    const s = batterySummary({ resting: { v: 12.5, at: now }, crank: { v: 9.7, at: now }, charging: { v: 14.1, at: now } }, now);
    expect(s).toMatchObject({ score: 70, state: 'watch', note: 'Battery 12.5 V · starting dip 9.7 V · charging 14.1 V' });
  });
  it('ignores readings older than two months', () => {
    expect(batterySummary({ resting: { v: 11.9, at: now - 70 * 86_400_000 } }, now)).toBeNull();
  });
  it('is null with nothing measured', () => {
    expect(batterySummary(null)).toBeNull();
    expect(batterySummary({ history: [], lastRunAt: 5 })).toBeNull();
  });
});

describe('storage', () => {
  beforeEach(() => localStorage.clear());
  it('keeps the latest of each kind plus history, and moves with the car', () => {
    saveBatteryReading('vin:X', { kind: 'resting', v: 12.6, at: 1 });
    saveBatteryReading('vin:X', { kind: 'resting', v: 12.4, at: 2 });
    saveLastRun('vin:X', 5);
    moveBattery('vin:X', 'car1');
    expect(loadBattery('vin:X')).toBeNull();
    expect(loadBattery('car1')).toMatchObject({ resting: { v: 12.4, at: 2 }, lastRunAt: 5 });
    expect(loadBattery('car1').history).toHaveLength(2);
  });
});
