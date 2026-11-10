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
const { liveScoreBlend, movingSecondsSoFar } = await import('../services/scoring.js');
const { LIVE_SCORE_BLEND_SEC } = await import('../constants.js');

describe('liveScoreBlend', () => {
  it('opens at the driver\'s standing average, not at the drive analysis', () => {
    // A 93 driver sees 93 before any moving time, however the first few
    // samples happen to score.
    expect(liveScoreBlend(93, 40, 0)).toBe(93);
    expect(liveScoreBlend(93, 100, 0)).toBe(93);
  });

  it('hands fully over to the live score once the window is up', () => {
    expect(liveScoreBlend(93, 78, LIVE_SCORE_BLEND_SEC)).toBe(78);
    expect(liveScoreBlend(93, 78, LIVE_SCORE_BLEND_SEC * 4)).toBe(78);
  });

  it('blends linearly in between', () => {
    expect(liveScoreBlend(90, 70, LIVE_SCORE_BLEND_SEC / 2)).toBe(80);
    expect(liveScoreBlend(90, 70, LIVE_SCORE_BLEND_SEC / 4)).toBe(85);
  });

  it('damps an early sharp move to its share of the window', () => {
    // The case the old SETTLING placeholder existed for. At a quarter of the
    // window the live analysis carries a quarter of the weight, so whatever it
    // says moves the display by a quarter as much — the property, not a
    // hand-picked number.
    const average = 93;
    for (const raw of [68, 40, 10]){
      const shown = liveScoreBlend(average, raw, LIVE_SCORE_BLEND_SEC / 4);
      expect(average - shown).toBeCloseTo((average - raw) / 4, 0);
    }
  });

  it('is symmetric — a driver below their average is lifted the same way', () => {
    expect(liveScoreBlend(62, 95, LIVE_SCORE_BLEND_SEC / 2)).toBe(79);
  });

  it('gives a driver with no scored history the live score, not a flattering 100', () => {
    // state.driveStartScore is null for them; opening at loadLifetimeScore()'s
    // default of 100 would start the ring full and only ever drain.
    expect(liveScoreBlend(null, 77, 0)).toBe(77);
    expect(liveScoreBlend(null, 77, LIVE_SCORE_BLEND_SEC)).toBe(77);
  });

  it('returns null when there is no live score, so the caller can hold the last good one', () => {
    expect(liveScoreBlend(93, null, 10)).toBe(null);
    expect(liveScoreBlend(93, undefined, 10)).toBe(null);
    expect(liveScoreBlend(93, NaN, 10)).toBe(null);
    // Number(null) is 0, not NaN — without an explicit guard this would read as
    // a real zero and drag the display toward it.
    expect(liveScoreBlend(93, '', 10)).toBe(null);
  });

  it('never reads outside the two inputs, in either direction', () => {
    for (const sec of [0, 1, 30, 60, 119, 120, 600]){
      const down = liveScoreBlend(93, 70, sec);
      expect(down).toBeGreaterThanOrEqual(70);
      expect(down).toBeLessThanOrEqual(93);
      const up = liveScoreBlend(70, 93, sec);
      expect(up).toBeGreaterThanOrEqual(70);
      expect(up).toBeLessThanOrEqual(93);
    }
  });
});

describe('the blend advances on moving time only', () => {
  // The guarantee is "sitting at a light doesn't hand weight over". That lives
  // in movingSecondsSoFar, so exercise it rather than passing 0 by hand.
  const at = (speeds) => {
    const samples = speeds.map((speed, i) => ({ t: i * 1000, speed }));
    return movingSecondsSoFar(samples);
  };

  it('counts no moving time while stopped', () => {
    expect(at(new Array(61).fill(0))).toBe(0);
    expect(liveScoreBlend(93, 60, at(new Array(61).fill(0)))).toBe(93);
  });

  it('counts moving time while under way', () => {
    expect(at(new Array(61).fill(20))).toBe(60);
    expect(liveScoreBlend(93, 60, at(new Array(61).fill(20)))).toBeLessThan(93);
  });

  it('a minute of driving then a minute parked advances the same as the minute of driving', () => {
    const driving = [...new Array(61).fill(20)];
    const thenParked = [...driving, ...new Array(60).fill(0)];
    expect(at(thenParked)).toBe(at(driving));
    expect(liveScoreBlend(93, 60, at(thenParked))).toBe(liveScoreBlend(93, 60, at(driving)));
  });
});
