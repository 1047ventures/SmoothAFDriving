import { describe, it, expect, beforeEach, vi } from 'vitest';

// Stub localStorage before module import
const store = {};
vi.stubGlobal('localStorage', {
  getItem:    k => store[k] ?? null,
  setItem:    (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
  clear:      () => Object.keys(store).forEach(k => delete store[k]),
});

const { detectEventWithThresh, deriveSpeed } = await import('../services/sensors/gps.js');

describe('deriveSpeed', () => {
  const prev = { t: 1000, lat: 39.0, lon: -104.0 };

  it('uses the GPS-reported speed when present', () => {
    expect(deriveSpeed({ speed: 12.3, latitude: 39.0, longitude: -104.0 }, prev, 2000)).toBeCloseTo(12.3, 2);
  });

  it('derives speed from distance moved when the reading is missing', () => {
    // ~111.1 m north of prev in 1s → ~111 m/s raw, but capped at 70.
    const far = { speed: null, latitude: 39.001, longitude: -104.0 };
    expect(deriveSpeed(far, prev, 2000)).toBe(70); // cap swallows the glitch
    // ~15.6 m north in 1s → ~15.6 m/s (~35 mph), a realistic reading, not capped.
    const real = { speed: -1, latitude: 39.00014, longitude: -104.0 };
    expect(deriveSpeed(real, prev, 2000)).toBeCloseTo(15.55, 1);
  });

  it('reads 0 (not a twitch) when parked and GPS only jitters a metre', () => {
    const jitter = { speed: null, latitude: 39.00001, longitude: -104.00001 };
    expect(deriveSpeed(jitter, prev, 2000)).toBe(0);
  });

  it('returns 0 with no previous fix and no reading', () => {
    expect(deriveSpeed({ speed: null, latitude: 39.0, longitude: -104.0 }, null)).toBe(0);
  });
});
const { createMotionHandler } = await import('../services/sensors/motion.js');
const { state, calib, resetCalib, resetState } = await import('../state.js');
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

  it('detects tier-4 extreme brake (2.6× threshold)', () => {
    const evt = detectEventWithThresh(-cfg.hardBrake * 2.7, 0, cfg, 0, 10);
    expect(evt).not.toBeNull();
    expect(evt.type).toBe('brake');
    expect(evt.tier).toBe(4);
  });

  it('tier-3 does NOT fire at tier-4 threshold', () => {
    // 2.6× threshold → must be tier 4, not tier 3
    const evt = detectEventWithThresh(-cfg.hardBrake * 2.7, 0, cfg, 0, 10);
    expect(evt?.tier).not.toBe(3);
  });

  it('detects tier-4 extreme acceleration', () => {
    const evt = detectEventWithThresh(cfg.hardAccel * 2.7, 0, cfg, 0, 10);
    expect(evt?.tier).toBe(4);
    expect(evt?.type).toBe('accel');
  });

  it('caps effective speed at posted limit × 1.1 for threshold scaling', () => {
    // With a 30 mph (13.4 m/s) limit, driving at 60 mph should use city thresholds
    state.currentSpeedLimitMps = 13.4; // 30 mph posted limit
    // At effective speed 13.4*1.1=14.74 m/s → still suburban band (>13.4), longMult=1.15
    // Without cap: actual speed 26.8 → highway longMult=1.35
    // Force that clears suburban tier-1 but not highway tier-1:
    const force = cfg.hardBrake * 1.15 * 0.58; // above suburban tier-1, below highway tier-1
    const evtCapped   = detectEventWithThresh(-force, 0, cfg, 0, 26.8);
    state.currentSpeedLimitMps = null;
    const evtUncapped = detectEventWithThresh(-force, 0, cfg, 0, 26.8);
    expect(evtCapped).not.toBeNull();   // capped to suburban — fires
    expect(evtUncapped).toBeNull();     // uncapped highway — does not fire
    state.currentSpeedLimitMps = null;
  });
});

describe('ride-jolt capture (Phase 2 data)', () => {
  // gravity on +z so the handler derives its vertical axis from ~60 samples;
  // motion rides on +z too, so once the axis is known vertAccel = z.
  const motionEv = z => ({ accelerationIncludingGravity:{x:0,y:0,z:9.81},
                           acceleration:{x:0,y:0,z:z}, rotationRate:null });

  // ~1s to derive the up-axis + ~1s to fill the 60-sample roughness buffer, so
  // feed a healthy warmup of gentle road texture before the event under test.
  function warmup(h, n = 140){ for (let i = 0; i < n; i++) h(motionEv((Math.random() - 0.5) * 0.2)); }

  beforeEach(() => {
    resetState();
    resetCalib();
    state.recording  = true;
    state.lastGpsPos = { lat:39.7, lon:-104.9, speed:12 };
    calib.gyroAvail  = false;   // force the accelerometer vertical path
  });

  it('records a sharp pothole spike as a peak jolt above the baseline', () => {
    const h = createMotionHandler({});
    warmup(h);
    const baseline = state.peakVertJolt;
    h(motionEv(6.5));                               // pothole
    expect(baseline).toBeLessThan(1);              // ambient road barely registers
    expect(state.peakVertJolt).toBeGreaterThan(4); // the hit stands well above it
  });

  it('peak-holds the worst jolt until it is consumed', () => {
    const h = createMotionHandler({});
    warmup(h);
    h(motionEv(7));   // big hit
    const peak = state.peakVertJolt;
    expect(peak).toBeGreaterThan(4);
    h(motionEv(2));   // a smaller later bump must not lower the held peak
    expect(state.peakVertJolt).toBe(peak);
  });
});
