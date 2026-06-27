import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub localStorage before any imports (drive.js → storage.js touches it)
vi.stubGlobal('localStorage', {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
});

const { state, resetState } = await import('../state.js');
const { buildDriveFromState } = await import('../services/drive.js');
const { analyzeDrive } = await import('../services/scoring.js');

// A smooth, steady cruise with a flood of minor tier-1 events — exactly the
// shape that collapsed the old cumulative-penalty live model to 0.
function seedSmoothDrive({ minutes = 17, eventCount = 160 } = {}) {
  resetState();
  state.startTime = 1_000_000;
  state.simulated = false;
  state.currentSpeedLimitMps = null;
  const n = minutes * 60; // 1 Hz sampling
  state.samples = [];
  for (let i = 0; i < n; i++) {
    state.samples.push({
      t:         state.startTime + i * 1000,
      lat:       39.85 + i * 1e-5,
      lon:       -105.147,
      speed:     24,     // steady ~54 mph
      heading:   180,
      harshness: 0.2,    // smooth
      longAccel: 0.1,
      latAccel:  0.05,
      distMeters: 24,
    });
  }
  state.events = [];
  for (let i = 0; i < eventCount; i++) {
    state.events.push({
      type: i % 2 ? 'accel' : 'brake',
      tier: 1, severity: 0.6,
      lat: 39.85, lon: -105.147,
      speedMph: 54, t: state.startTime + i * 1000,
      la: i % 2 ? 2.5 : -2.5, ra: null,
    });
  }
}

describe('live score unification', () => {
  beforeEach(() => seedSmoothDrive());

  it('buildDriveFromState maps state into an analyzable drive object', () => {
    const d = buildDriveFromState();
    expect(d.samples.length).toBe(17 * 60);
    expect(d.eventCount).toBe(160);
    expect(d.samples[0]).toHaveProperty('la');
    expect(d.samples[0]).toHaveProperty('ra');
    expect(d.samples[0]).toHaveProperty('h');
    expect(d.samples[0].t).toBe(0); // times are relative to startTime
  });

  it('regression: a smooth 17-min drive with 160 minor events scores high, not 0', () => {
    const score = analyzeDrive(buildDriveFromState()).score;
    // The old cumulative-penalty live model returned 0 for this exact shape.
    expect(score).toBeGreaterThan(70);
  });

  it('live path and stored path are the same engine (single source of truth)', () => {
    const stored = analyzeDrive(buildDriveFromState()).score;
    const live   = analyzeDrive(buildDriveFromState()).score;
    expect(live).toBe(stored);
  });
});
