import { describe, it, expect, vi } from 'vitest';

// Stub localStorage before any imports
vi.stubGlobal('localStorage', {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
});

const { buildExportData } = await import('../ui/review.js');

const DRIVE = {
  startTime: 1750000000000,
  score: 87,
  distanceMeters: 3862,
  durationMs: 420000,
  topSpeedMps: 13.4,
  events: [
    { type: 'brake', tier: 2, severity: 1.4, t: 1750000060000,
      lat: 39.74, lon: -104.99, speedMph: 18, roadRoughness: 0.3 },
  ],
  samples: [
    { t: 1750000000000, lat: 39.74, lon: -104.99, speed: 8.2, heading: 92,
      longAccel: 0.1, latAccel: -0.05, jerk: 0.02, harshness: 0.11, roadRoughness: 0.18 },
  ],
};

const ANALYSIS = {
  score: 87,
  dims: { peakHarshness: 91, throttle: 88, steering: 94, braking: 85,
          cornering: 90, transitions: 87, momentum: 83 },
};

describe('buildExportData', () => {
  it('produces the correct top-level keys', () => {
    const data = buildExportData(DRIVE, ANALYSIS);
    expect(Object.keys(data)).toEqual(['meta', 'dims', 'events', 'samples']);
  });

  it('meta has required fields', () => {
    const { meta } = buildExportData(DRIVE, ANALYSIS);
    expect(meta.score).toBe(87);
    expect(meta.durationSecs).toBe(420);
    expect(meta.distanceMiles).toBeCloseTo(2.4, 0);
    expect(typeof meta.exportedAt).toBe('number');
    expect(typeof meta.appVersion).toBe('string');
  });

  it('dims are passed through from analysis', () => {
    const { dims } = buildExportData(DRIVE, ANALYSIS);
    expect(dims.peakHarshness).toBe(91);
    expect(dims.momentum).toBe(83);
  });

  it('events are passed through unchanged', () => {
    const { events } = buildExportData(DRIVE, ANALYSIS);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('brake');
    expect(events[0].tier).toBe(2);
  });

  it('samples contain only the specified fields', () => {
    const { samples } = buildExportData(DRIVE, ANALYSIS);
    expect(samples).toHaveLength(1);
    const s = samples[0];
    expect(Object.keys(s).sort()).toEqual(
      ['harshness','heading','jerk','latAccel','lon','longAccel','lat','roadRoughness','speed','t'].sort()
    );
  });

  it('handles null analysis gracefully', () => {
    const data = buildExportData(DRIVE, null);
    expect(data.dims).toBeNull();
  });
});
