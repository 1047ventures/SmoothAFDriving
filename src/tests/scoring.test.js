import { describe, it, expect } from 'vitest';
import { scoreFromEvents, analyzeDrive, getDriverPersona } from '../services/scoring.js';
import { effectivenessScore, destinationTier } from '../services/scoring.js';
import { clockModifier, compositeScore, computePitStopMs, movingSeconds, momentumSeries, driveNarrative, driveFacts } from '../services/scoring.js';
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

describe('computePitStopMs', () => {
  // Samples: t in ms, speed in m/s. Threshold PIT_STOP_MS=180000 (3 min), PIT_SPEED_MPS=0.7.
  const moving = (t) => ({ t, speed: 12 });
  const parked = (t) => ({ t, speed: 0 });

  it('ignores short stops (a red light under 3 min)', () => {
    const s = [moving(0), parked(1000), parked(120000), moving(121000)]; // ~2 min stop
    expect(computePitStopMs(s)).toBe(0);
  });
  it('counts a long stop (gas run) in full', () => {
    // parked from t=1000 to t=241000 (240s ≥ 180s), resumes at 250000
    const s = [moving(0), parked(1000), parked(241000), moving(250000)];
    expect(computePitStopMs(s)).toBe(240000);
  });
  it('counts a trailing in-progress pit once it crosses the threshold', () => {
    const s = [moving(0), parked(1000), parked(200000)]; // 199s parked, still stopped
    expect(computePitStopMs(s)).toBe(199000);
  });
  it('sums multiple pit stops', () => {
    const s = [
      moving(0), parked(1000), parked(191000), moving(200000),   // 190s pit
      moving(400000), parked(401000), parked(601000), moving(610000), // 200s pit
    ];
    expect(computePitStopMs(s)).toBe(390000);
  });
  it('returns 0 for too-few samples', () => {
    expect(computePitStopMs([])).toBe(0);
    expect(computePitStopMs([parked(0)])).toBe(0);
  });
});

describe('momentumSeries', () => {
  const mkSamples = (n, laFn) => Array.from({ length: n }, (_, i) => ({
    t: i * 1000, speed: 12, la: laFn ? laFn(i) : 0, ra: 0,
  }));

  it('returns [] for too-few samples', () => {
    expect(momentumSeries({ samples: [] })).toEqual([]);
    expect(momentumSeries({ samples: mkSamples(3) })).toEqual([]);
  });
  it('produces high, flat scores for a perfectly smooth drive', () => {
    const series = momentumSeries({ samples: mkSamples(200), events: [] }, 20);
    expect(series.length).toBe(20);
    expect(series.every(p => p.score >= 95)).toBe(true);
    expect(series.every(p => p.score <= 100)).toBe(true);
  });
  it('dips where the driving gets rough', () => {
    // smooth for the first half, harsh braking in the second half
    const samples = mkSamples(200, i => i > 120 ? -4.5 : 0);
    const series = momentumSeries({ samples, events: [] }, 20);
    const firstHalfAvg = series.slice(0, 8).reduce((s, p) => s + p.score, 0) / 8;
    const secondHalfAvg = series.slice(14).reduce((s, p) => s + p.score, 0) / series.slice(14).length;
    expect(secondHalfAvg).toBeLessThan(firstHalfAvg - 20);
  });
  it('carries a t (ms) and score on every point', () => {
    const series = momentumSeries({ samples: mkSamples(100), events: [] }, 10);
    expect(series[0]).toHaveProperty('t');
    expect(series[0]).toHaveProperty('score');
    expect(series[series.length - 1].t).toBeGreaterThan(series[0].t);
  });
});

describe('driveNarrative', () => {
  // A real destination haul (arrived, beat the ETA)
  const haul = {
    startTime: 1752900000000, durationMs: 1560000, distanceMeters: 15600, topSpeedMps: 27,
    destination: { label: 'Boulder, CO' }, arrived: true,
    targetEtaSec: 1500, movingSec: 1440, pitStopMs: 0, score: 91, effectiveness: 96, events: [],
  };
  const haulAnalysis = { avgSpeedMph: 36, fullStops: 1, stopsPerMile: 0.1,
    dims: { cornering: 93, throttle: 90, braking: 82, steering: 88, transitions: 87, momentum: 85, peakHarshness: 84 } };

  // A short, slow, stop-and-go neighborhood hop (no destination) — the real trip
  const hop = {
    startTime: 1784513643468, durationMs: 381000, distanceMeters: 2269, topSpeedMps: 17, score: 87,
    events: [
      { type: 'brake', tier: 2, severity: 1.26, t: 109269 },
      { type: 'brake', tier: 2, severity: 1.17, t: 146937 },
      { type: 'accel', tier: 2, severity: 1.16, t: 157521 },
    ],
  };
  const hopAnalysis = { avgSpeedMph: 13, fullStops: 6, stopsPerMile: 4.2,
    dims: { steering: 100, braking: 100, cornering: 100, transitions: 100, momentum: 53, throttle: 86, peakHarshness: 85 } };

  it('is tight (at most 3 short lines) and carries no digits', () => {
    const s = driveNarrative(hop, hopAnalysis, 'Skelly');
    expect(s.length).toBeLessThanOrEqual(3);
    expect(s.join(' ')).not.toMatch(/[0-9]/); // all numbers live in driveFacts
  });
  it('a short local hop reads as a quick trip with no clock framing', () => {
    const joined = driveNarrative(hop, hopAnalysis, 'Skelly').join(' ');
    expect(joined).not.toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/i);
    expect(joined).not.toMatch(/ETA|schedule/);
    expect(joined).toMatch(/hop|run|errand/i);
  });
  it('recognises stop-and-go + dialed hands in one line', () => {
    const s = driveNarrative(hop, hopAnalysis, 'Skelly');
    expect(s[0]).toMatch(/stop-and-go/i);
    expect(s[0]).toMatch(/dialed/i);
  });
  it('clusters bunched-up rough moments into one patch', () => {
    const s = driveNarrative(hop, hopAnalysis, 'Skelly').join(' ');
    expect(s).toMatch(/one firm patch/i);
  });
  it('leads a real haul with destination + clock, no digits', () => {
    const s = driveNarrative(haul, haulAnalysis, 'Skelly');
    const joined = s.join(' ');
    expect(joined).toContain('Boulder');
    expect(joined).toMatch(/ETA|schedule/);
    expect(joined).not.toMatch(/[0-9]/);
  });
  it('is deterministic for the same drive', () => {
    expect(driveNarrative(hop, hopAnalysis, 'Skelly').join(' '))
      .toBe(driveNarrative(hop, hopAnalysis, 'Skelly').join(' '));
  });
});

describe('driveFacts', () => {
  const hop = { durationMs: 381000, distanceMeters: 2269, topSpeedMps: 17 };
  const hopA = { avgSpeedMph: 13, fullStops: 4 };
  const haul = { durationMs: 1560000, distanceMeters: 15600, topSpeedMps: 27,
    targetEtaSec: 1500, movingSec: 1440, pitStopMs: 120000, effectiveness: 96 };
  const haulA = { avgSpeedMph: 36, fullStops: 1 };

  it('extracts pace + stops for a plain drive', () => {
    const f = driveFacts(hop, hopA);
    const labels = f.map(x => x.label);
    expect(labels).toEqual(['Avg', 'Top', 'Stops']);
    expect(f[0]).toMatchObject({ value: '13', unit: 'mph' });
    expect(f.find(x => x.label === 'Stops').value).toBe('4');
  });
  it('adds the clock margin + pit for a destination drive', () => {
    const f = driveFacts(haul, haulA);
    const labels = f.map(x => x.label);
    expect(labels).toContain('Ahead'); // 1440s vs 1500*1.2=1800 → 6 min ahead
    expect(labels).toContain('Pit');
    expect(f.find(x => x.label === 'Ahead').value).toBe('6');
    expect(f.find(x => x.label === 'Pit').value).toBe('2');
  });
});

describe('movingSeconds', () => {
  it('subtracts pit time from wall-clock', () => {
    expect(movingSeconds(1200, 300)).toBe(900);
  });
  it('floors at zero and rounds', () => {
    expect(movingSeconds(100, 500)).toBe(0);
    expect(movingSeconds(120.4, 0)).toBe(120);
  });
});

describe('clockModifier lateness penalty (allowPenalty)', () => {
  it('does not penalize when allowPenalty is false', () => {
    expect(clockModifier(600, 900, 90, false)).toBe(0);
  });
  it('penalizes when late and allowPenalty is true', () => {
    // target = 600*1.2 = 720; actual 900 → 25% over → full -15 swing (capped at CLOCK_LATE_FULL 20%)
    expect(clockModifier(600, 900, 90, true)).toBeLessThan(0);
  });
  it('never penalizes when on time even with allowPenalty', () => {
    expect(clockModifier(600, 700, 90, true)).toBeGreaterThanOrEqual(0);
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
