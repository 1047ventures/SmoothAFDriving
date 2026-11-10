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

// ── Opening score: the driver's average, handing over to this drive ──────────
const { liveScoreBlend } = await import('../services/scoring.js');
const { LIVE_SCORE_SETTLE_SEC } = await import('../constants.js');

describe('liveScoreBlend', () => {
  it('opens at the driver\'s standing average, not at the drive analysis', () => {
    // A 93 driver sees 93 before any moving time, however the first few
    // samples happen to score.
    expect(liveScoreBlend(93, 40, 0)).toBe(93);
    expect(liveScoreBlend(93, 100, 0)).toBe(93);
  });

  it('hands fully over to the live score once settled', () => {
    expect(liveScoreBlend(93, 78, LIVE_SCORE_SETTLE_SEC)).toBe(78);
    // and stays there well past the window
    expect(liveScoreBlend(93, 78, LIVE_SCORE_SETTLE_SEC * 4)).toBe(78);
  });

  it('blends linearly in between', () => {
    const mid = LIVE_SCORE_SETTLE_SEC / 2;
    expect(liveScoreBlend(90, 70, mid)).toBe(80);
  });

  it('damps an early sharp move instead of letting it swing the number', () => {
    // The case the old SETTLING placeholder existed for: one harsh input a
    // minute in reads ~25 points low on the raw analysis.
    const raw = 68, average = 93;
    const shown = liveScoreBlend(average, raw, 60);
    const rawDrop = average - raw;           // 25
    const shownDrop = average - shown;
    expect(shownDrop).toBeLessThan(rawDrop / 3);
    expect(shown).toBeGreaterThan(85);
  });

  it('only counts moving time, so sitting at a light does not advance it', () => {
    // movingSecondsSoFar feeds this; a stationary minute contributes 0.
    expect(liveScoreBlend(93, 60, 0)).toBe(93);
  });

  it('falls back to the live score when there is no usable average', () => {
    expect(liveScoreBlend(null, 77, 0)).toBe(77);
    expect(liveScoreBlend(undefined, 77, 999)).toBe(77);
  });

  it('returns null when there is no live score to show', () => {
    expect(liveScoreBlend(93, null, 10)).toBe(null);
    expect(liveScoreBlend(93, undefined, 10)).toBe(null);
  });

  it('never reads outside the two inputs', () => {
    for (const sec of [0, 1, 30, 150, 299, 300, 600]){
      const v = liveScoreBlend(93, 70, sec);
      expect(v).toBeGreaterThanOrEqual(70);
      expect(v).toBeLessThanOrEqual(93);
    }
  });
});
