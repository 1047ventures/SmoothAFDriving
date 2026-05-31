import { describe, it, expect, beforeEach, vi } from 'vitest';

// Stub localStorage before module import
const store = {};
vi.stubGlobal('localStorage', {
  getItem:    k => store[k] ?? null,
  setItem:    (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
  clear:      () => Object.keys(store).forEach(k => delete store[k]),
});

const { detectEventWithThresh } = await import('../services/sensors/gps.js');
const { state, calib, resetCalib } = await import('../state.js');
const { DEFAULTS } = await import('../constants.js');

const cfg = { ...DEFAULTS };

beforeEach(() => {
  resetCalib();
  state.emaLongAccel = 0;
  state.emaLatAccel  = 0;
});

describe('detectEventWithThresh', () => {
  it('returns null when forces are below all tiers', () => {
    expect(detectEventWithThresh(0.1, 0.1, cfg, 0, 10)).toBeNull();
  });

  it('detects tier-2 hard brake', () => {
    const evt = detectEventWithThresh(-cfg.hardBrake * 1.1, 0, cfg, 0, 20);
    expect(evt).not.toBeNull();
    expect(evt.type).toBe('brake');
    expect(evt.tier).toBe(2);
  });

  it('detects tier-3 very hard brake', () => {
    const evt = detectEventWithThresh(-cfg.hardBrake * 2.0, 0, cfg, 0, 20);
    expect(evt).not.toBeNull();
    expect(evt.tier).toBe(3);
  });

  it('detects tier-1 subtle brake', () => {
    const evt = detectEventWithThresh(-cfg.hardBrake * 0.6, 0, cfg, 0, 20);
    expect(evt).not.toBeNull();
    expect(evt.tier).toBe(1);
  });

  it('detects hard acceleration', () => {
    const evt = detectEventWithThresh(cfg.hardAccel * 1.1, 0, cfg, 0, 20);
    expect(evt).not.toBeNull();
    expect(evt.type).toBe('accel');
  });

  it('detects sharp turn', () => {
    const evt = detectEventWithThresh(0, cfg.sharpTurn * 1.1, cfg, 0, 5);
    expect(evt).not.toBeNull();
    expect(evt.type).toBe('turn');
  });

  it('doubles turn threshold at highway speed', () => {
    // At highway speed (>13.4 m/s), 1.1× threshold should NOT trigger
    const evt = detectEventWithThresh(0, cfg.sharpTurn * 1.1, cfg, 0, 30);
    expect(evt).toBeNull();
  });

  it('detects jerk/shift event (requires la > 0.5 and jerk > threshold)', () => {
    // jerk detection gate: Math.abs(la) > 0.5 AND jerk > jerkThreshold
    const evt = detectEventWithThresh(0.6, 0, cfg, cfg.jerkThreshold * 1.1, 20);
    expect(evt).not.toBeNull();
    expect(evt.type).toBe('shift');
  });
});
