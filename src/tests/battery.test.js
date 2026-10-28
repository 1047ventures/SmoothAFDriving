import { describe, it, expect, beforeEach } from 'vitest';
import { parseAtrv, runningFrom, createBatteryWatch, keepResting, classify, batterySummary, saveBatteryReading, saveLastRun, loadBattery, moveBattery } from '../services/battery.js';

const HOUR = 3_600_000;

// Feed a sequence of voltages at a fixed interval; collect every reading emitted.
function run(watch, volts, { from = 10 * HOUR, every = 250, ecuOn = false, rpm = null, speed = null } = {}){
  const out = [];
  volts.forEach((v, i) => out.push(...watch.feed({ t: from + i * every, v, rpm, speed, ecuOn })));
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

describe('runningFrom', () => {
  it('trusts speed and RPM over voltage', () => {
    expect(runningFrom({ v: 12.8, rpm: 0, speed: 40, ecuOn: true })).toBe(true);   // EV driving
    expect(runningFrom({ v: 12.8, rpm: 750, ecuOn: true })).toBe(true);            // smart charging
    expect(runningFrom({ v: 13.8, rpm: 0, speed: 0, ecuOn: true })).toBe(false);   // charger on a parked car
    expect(runningFrom({ v: 12.5, ecuOn: true })).toBeNull();                      // awake but nothing read
    expect(runningFrom({ v: 12.5 })).toBe(false);
    expect(runningFrom({ v: 13.9 })).toBe(true);
    expect(runningFrom({ v: null, rpm: 800 })).toBe(true);                         // ATRV failed
  });
});

describe('createBatteryWatch', () => {
  it('logs a resting reading with the ignition off', () => {
    const out = run(createBatteryWatch(), rep(12.48, 12));
    expect(out).toEqual([{ kind: 'resting', v: 12.48, at: expect.any(Number) }]);
  });
  it('skips resting with the engine computer awake', () => {
    expect(run(createBatteryWatch(), rep(12.4, 12), { ecuOn: true, rpm: 0, speed: 0 })).toEqual([]);
  });
  it('never decides "off" on a guess: unknown evidence keeps it unknown', () => {
    const w = createBatteryWatch();
    run(w, rep(null, 50), { rpm: 800 });
    expect(w.mode).toBe('running');
    const w2 = createBatteryWatch();
    run(w2, rep(12.5, 5), { ecuOn: true });
    expect(w2.mode).toBeNull();
  });
  it('keeps an EV that is moving at 0 rpm running', () => {
    const w = createBatteryWatch();
    run(w, rep(12.8, 20), { ecuOn: true, rpm: 0, speed: 50 });
    expect(w.mode).toBe('running');
  });
  it('catches the crank dip, then a charging reading from the high points', () => {
    const w = createBatteryWatch();
    const out = run(w, [...rep(12.5, 10), 10.8, 9.9, 10.4, 12.1, 13.9]);
    expect(out.map(r => r.kind)).toEqual(['resting', 'crank']);
    expect(out[1].v).toBe(9.9);
    expect(w.mode).toBe('running');
    // Smart charging: mostly 12.9 V with bursts at 14.3 V.
    const volts = Array.from({ length: 100 }, (_, i) => (i % 4 === 0 ? 14.3 : 12.9));
    const charging = run(w, volts, { from: 10 * HOUR + 5000, every: 1000, ecuOn: true, rpm: 800, speed: 30 });
    expect(charging).toEqual([{ kind: 'charging', v: 14.3, at: expect.any(Number) }]);
  });
  it('files no charging reading from a battery charger (no RPM ever seen)', () => {
    const w = createBatteryWatch();
    expect(run(w, rep(13.8, 200), { every: 1000 })).toEqual([]);
  });
  it('drops a crank it sampled too sparsely to trust', () => {
    const out = run(createBatteryWatch(), [12.5, 12.5, 12.5, 13.9], { every: 2000 });
    expect(out.some(r => r.kind === 'crank')).toBe(false);
  });
  it('drops a "crank" with no dip', () => {
    const out = run(createBatteryWatch(), [...rep(12.5, 10), 13.9]);
    expect(out.some(r => r.kind === 'crank')).toBe(false);
  });
  it('notices the engine stop, and holds resting for an hour after', () => {
    const w = createBatteryWatch();
    run(w, [14.1, 14.1], { ecuOn: true, rpm: 800 });
    expect(run(w, rep(12.7, 12), { from: 10 * HOUR + 10_000 })).toEqual([]);
    expect(w.mode).toBe('off');
    expect(run(w, rep(12.6, 12), { from: 11.1 * HOUR })).toHaveLength(1);
  });
});

describe('keepResting', () => {
  it('needs an hour since the engine ran, or a believable figure if unknown', () => {
    expect(keepResting({ v: 12.6, at: 2 * HOUR }, 1.5 * HOUR)).toBe(false);
    expect(keepResting({ v: 12.6, at: 3 * HOUR }, 1.5 * HOUR)).toBe(true);
    expect(keepResting({ v: 12.85, at: 3 * HOUR }, 0)).toBe(false);
    expect(keepResting({ v: 12.5, at: 3 * HOUR }, 0)).toBe(true);
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
    expect(classify('charging', 13.4).state).toBe('good');
    expect(classify('charging', 12.4).state).toBe('bad');
    expect(classify('charging', 15.3).state).toBe('bad');
  });
});

describe('batterySummary', () => {
  const now = 100 * 86_400_000;
  it('scores the worst current reading and notes the voltages', () => {
    const s = batterySummary({ resting: { v: 12.5, at: now }, crank: { v: 9.7, at: now }, charging: { v: 14.1, at: now } }, now);
    expect(s).toMatchObject({ score: 70, state: 'watch', note: 'Battery: starting dip 9.7 V' });
    expect(batterySummary({ resting: { v: 12.62, at: now } }, now).note).toBe('Battery OK');
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
    expect(loadBattery('car1').history).toHaveLength(1);   // same kind within the hour
  });
});
