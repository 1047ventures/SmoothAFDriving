import { describe, it, expect } from 'vitest';
import { createStartStopLearner, carHasStartStop } from '../services/startStop.js';
import { OBD_DEVICE_KEY } from '../constants.js';

function memStore(){
  const m = new Map([[OBD_DEVICE_KEY, JSON.stringify({ deviceId: 'dongle-1' })]]);
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
}
// 1 Hz. Each phase: { secs, rpm, speed }.
function drive(store, phases){
  const l = createStartStopLearner(store); let t = 0;
  for (const p of phases) for (let i = 0; i < p.secs; i++, t += 1000) l.observe({ now: t, rpm: p.rpm, speedKmh: p.speed });
}
const cruise = { secs: 30, rpm: 2000, speed: 60 };
const idleStop = { secs: 20, rpm: 750, speed: 0 };

describe('learning whether a car has start-stop', () => {
  it("doesn't know until it has seen enough", () => {
    const s = memStore();
    expect(carHasStartStop(s)).toBe(null);
    drive(s, [cruise, idleStop, cruise, idleStop, cruise]);
    expect(carHasStartStop(s)).toBe(null);
  });

  it('5 stops idling with the engine running → no start-stop', () => {
    const s = memStore();
    drive(s, [cruise, idleStop, cruise, idleStop, cruise, idleStop]);
    drive(s, [cruise, idleStop, cruise, idleStop, cruise]);
    expect(carHasStartStop(s)).toBe(false);
  });

  it('the engine stopping at a light and restarting by itself → start-stop, for good', () => {
    const s = memStore();
    for (let i = 0; i < 3; i++) drive(s, [cruise, idleStop, cruise, idleStop]);
    expect(carHasStartStop(s)).toBe(false);
    drive(s, [cruise, { secs: 20, rpm: 0, speed: 0 }, { secs: 5, rpm: 900, speed: 0 }, cruise]);
    expect(carHasStartStop(s)).toBe(true);
    for (let i = 0; i < 5; i++) drive(s, [cruise, idleStop]);
    expect(carHasStartStop(s)).toBe(true);
  });

  it('a 0 before the engine first starts is just the key turning on', () => {
    const s = memStore();
    drive(s, [{ secs: 10, rpm: 0, speed: 0 }, { secs: 10, rpm: 800, speed: 0 }, cruise]);
    expect(carHasStartStop(s)).toBe(null);
  });
});
