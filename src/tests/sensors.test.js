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
    // speed=10 keeps longMult=1.0 so raw thresholds apply
    const evt = detectEventWithThresh(-cfg.hardBrake * 1.1, 0, cfg, 0, 10);
    expect(evt).not.toBeNull();
    expect(evt.type).toBe('brake');
    expect(evt.tier).toBe(2);
  });

  it('detects tier-3 very hard brake', () => {
    const evt = detectEventWithThresh(-cfg.hardBrake * 2.0, 0, cfg, 0, 10);
    expect(evt).not.toBeNull();
    expect(evt.tier).toBe(3);
  });

  it('detects tier-1 subtle brake', () => {
    const evt = detectEventWithThresh(-cfg.hardBrake * 0.6, 0, cfg, 0, 10);
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

  it('returns null below 2 m/s regardless of force', () => {
    // GPS noise at near-stop speed should never produce events
    expect(detectEventWithThresh(-cfg.hardBrake * 3, 0, cfg, 0, 1.5)).toBeNull();
    expect(detectEventWithThresh(cfg.hardAccel * 3, 0, cfg, 0, 0)).toBeNull();
  });

  it('raises brake threshold at suburban speed (>30 mph / 13.4 m/s)', () => {
    // Force between city tier-1 (hardBrake*0.55) and suburban tier-1 (hardBrake*1.15*0.55)
    // City tier-1 = 4.5*0.55 = 2.475  |  Suburban tier-1 = 4.5*1.15*0.55 = 2.846
    const force = cfg.hardBrake * 0.60; // 2.70 — above city, below suburban
    const cityEvt     = detectEventWithThresh(-force, 0, cfg, 0, 10);
    const suburbanEvt = detectEventWithThresh(-force, 0, cfg, 0, 15);
    expect(cityEvt).not.toBeNull();
    expect(suburbanEvt).toBeNull();
  });

  it('raises brake threshold further at highway speed (>50 mph / 22.4 m/s)', () => {
    // Force between suburban tier-1 (2.846) and highway tier-1 (4.5*1.35*0.55 = 3.341)
    const force = cfg.hardBrake * 0.67; // 3.015 — above suburban, below highway
    const suburbanEvt = detectEventWithThresh(-force, 0, cfg, 0, 15);
    const highwayEvt  = detectEventWithThresh(-force, 0, cfg, 0, 25);
    expect(suburbanEvt).not.toBeNull();
    expect(highwayEvt).toBeNull();
  });
});
