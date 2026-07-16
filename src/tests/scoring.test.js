import { describe, it, expect } from 'vitest';
import { scoreFromEvents, analyzeDrive, getDriverPersona } from '../services/scoring.js';
import { effectivenessScore, destinationTier } from '../services/scoring.js';
import { clockModifier, compositeScore } from '../services/scoring.js';
import { DEFAULTS } from '../constants.js';

const cfg = { ...DEFAULTS };

describe('scoreFromEvents', () => {
  it('returns 100 for no events', () => {
    expect(scoreFromEvents([], cfg, 300)).toBe(100);
  });

  it('deducts points for a tier-2 brake event', () => {
    const events = [{ type: 'brake', tier: 2, severity: 1 }];
    const score = scoreFromEvents(events, cfg, 300);
    expect(score).toBeLessThan(100);
    expect(score).toBeGreaterThan(0);
  });

  it('tier-3 deducts more than tier-2', () => {
    const tier2 = scoreFromEvents([{ type: 'brake', tier: 2, severity: 1 }], cfg, 300);
    const tier3 = scoreFromEvents([{ type: 'brake', tier: 3, severity: 1 }], cfg, 300);
    expect(tier3).toBeLessThan(tier2);
  });

  it('blends toward 100 for short drives (low sample count)', () => {
    const events = [{ type: 'brake', tier: 2, severity: 1 }];
    const longDrive  = scoreFromEvents(events, cfg, 1000);
    const shortDrive = scoreFromEvents(events, cfg, 10);
    expect(shortDrive).toBeGreaterThan(longDrive);
  });

  it('skips shift events (informational only)', () => {
    const shift = scoreFromEvents([{ type: 'shift', tier: 2, severity: 1 }], cfg, 300);
    expect(shift).toBe(100);
  });

  it('applies road roughness reduction', () => {
    const smooth = scoreFromEvents([{ type: 'brake', tier: 2, severity: 1, roadRoughness: 0 }], cfg, 300);
    const rough  = scoreFromEvents([{ type: 'brake', tier: 2, severity: 1, roadRoughness: 3.5 }], cfg, 300);
    expect(rough).toBeGreaterThan(smooth);
  });
});

describe('analyzeDrive', () => {
  const makeDrive = (samples, events = []) => ({
    samples, events, durationMs: samples.length * 1000,
    distanceMeters: 1000, topSpeedMps: 15,
  });

  it('returns safe defaults for very short drives', () => {
    const result = analyzeDrive(makeDrive([]));
    expect(result.score).toBe(85);
    expect(result.dims.momentum).toBe(85);
  });

  it('returns a score between 0 and 100 for a normal drive', () => {
    const samples = Array.from({ length: 50 }, (_, i) => ({
      t: i * 1000, lat: 39.7 + i * 0.0001, lon: -104.9,
      speed: 10, h: 0.5, la: 0.1, ra: 0.05,
    }));
    const result = analyzeDrive(makeDrive(samples));
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('detects full stops correctly', () => {
    const samples = [
      ...Array.from({ length: 10 }, (_, i) => ({ t: i * 1000, speed: 10, lat: 39.7, lon: -104.9, la: 0, ra: 0, h: 0 })),
      ...Array.from({ length: 5 }, (_, i)  => ({ t: (10 + i) * 1000, speed: 0, lat: 39.7, lon: -104.9, la: 0, ra: 0, h: 0 })),
      ...Array.from({ length: 10 }, (_, i) => ({ t: (15 + i) * 1000, speed: 10, lat: 39.7, lon: -104.9, la: 0, ra: 0, h: 0 })),
    ];
    const result = analyzeDrive(makeDrive(samples));
    expect(result.fullStops).toBeGreaterThanOrEqual(1);
  });
});

describe('getDriverPersona', () => {
  it('returns null for fewer than 2 drives', () => {
    expect(getDriverPersona([])).toBeNull();
    expect(getDriverPersona([{ score: 90, distanceMeters: 5000, durationMs: 600000, topSpeedMps: 20 }])).toBeNull();
  });

  it('returns an object with title and sub for 2+ drives', () => {
    const drives = Array.from({ length: 5 }, () => ({
      score: 88, distanceMeters: 10000, durationMs: 900000, topSpeedMps: 25,
    }));
    const persona = getDriverPersona(drives);
    expect(persona).not.toBeNull();
    expect(typeof persona.title).toBe('string');
    expect(typeof persona.sub).toBe('string');
  });
});

describe('effectivenessScore', () => {
  it('is 100 when on time or faster', () => {
    expect(effectivenessScore(600, 720)).toBe(100);
    expect(effectivenessScore(600, 500)).toBe(100);
  });
  it('decays when late (PACE_PENALTY 180)', () => {
    expect(effectivenessScore(600, 864)).toBe(64);
    expect(effectivenessScore(600, 720 * 1.6)).toBe(0);
  });
  it('guards invalid input with null', () => {
    expect(effectivenessScore(0, 500)).toBeNull();
    expect(effectivenessScore(600, 0)).toBeNull();
    expect(effectivenessScore(-1, 500)).toBeNull();
  });
});

describe('destinationTier', () => {
  it('maps the on-time column', () => {
    expect(destinationTier(100, 95)).toBe('S');
    expect(destinationTier(100, 80)).toBe('A');
    expect(destinationTier(100, 70)).toBe('B');
  });
  it('maps the close-late column (65..99)', () => {
    expect(destinationTier(70, 95)).toBe('A');
    expect(destinationTier(70, 80)).toBe('B');
    expect(destinationTier(70, 70)).toBe('C');
  });
  it('maps the late column (<65)', () => {
    expect(destinationTier(40, 95)).toBe('B');
    expect(destinationTier(40, 80)).toBe('C');
    expect(destinationTier(40, 70)).toBe('D');
  });
  it('returns null when either axis is null', () => {
    expect(destinationTier(null, 90)).toBeNull();
    expect(destinationTier(100, null)).toBeNull();
  });
});

describe('clockModifier', () => {
  // ETA_BUFFER 1.2 → target = 600*1.2 = 720s
  it('is 0 when exactly on the buffered target', () => {
    expect(clockModifier(600, 720, 95)).toBe(0);
  });
  it('bonus scales with beat margin and is smoothness-gated', () => {
    // beat by 20% (actual 576 = 720*0.8) → pace 1 → 15 * 1 * 0.95 = 14.25
    expect(clockModifier(600, 576, 95)).toBeCloseTo(14.25, 2);
    // efficiency 100 → full 15
    expect(clockModifier(600, 576, 100)).toBeCloseTo(15, 2);
    // rough driver (eff 60) beating the clock earns little → 15*1*0.6 = 9
    expect(clockModifier(600, 576, 60)).toBeCloseTo(9, 2);
    // beat by 10% (actual 648) → pace 0.5 → 15*0.5*0.95 = 7.125
    expect(clockModifier(600, 648, 95)).toBeCloseTo(7.125, 2);
  });
  it('no penalty unless allowPenalty', () => {
    // 20% late (actual 864) → 0 by default
    expect(clockModifier(600, 864, 95)).toBe(0);
    // with penalty → pace 1 → -15 (penalty NOT smoothness-gated)
    expect(clockModifier(600, 864, 95, true)).toBeCloseTo(-15, 2);
    // 10% late (actual 792) with penalty → pace 0.5 → -7.5
    expect(clockModifier(600, 792, 95, true)).toBeCloseTo(-7.5, 2);
  });
  it('is 0 for invalid input', () => {
    expect(clockModifier(0, 500, 95)).toBe(0);
    expect(clockModifier(600, 0, 95)).toBe(0);
  });
});

describe('compositeScore', () => {
  it('is efficiency-only without arrival or eta', () => {
    expect(compositeScore(95, 600, 576, { arrived: false })).toBe(95);
    expect(compositeScore(95, 0, 0, { arrived: true })).toBe(95);
  });
  it('adds the clock bonus on an arrived destination drive', () => {
    expect(compositeScore(95, 600, 576, { arrived: true })).toBe(109); // 95 + 14.25 → 109
    expect(compositeScore(100, 600, 576, { arrived: true })).toBe(115); // caps at SCORE_MAX
  });
  it('reckless-but-fast cannot break 100', () => {
    expect(compositeScore(60, 600, 576, { arrived: true })).toBe(69); // 60 + 9
  });
  it('applies the penalty only when allowPenalty', () => {
    expect(compositeScore(95, 600, 864, { arrived: true })).toBe(95);                    // late, no penalty
    expect(compositeScore(95, 600, 864, { arrived: true, allowPenalty: true })).toBe(80); // 95 - 15
  });
});
