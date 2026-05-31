import { describe, it, expect } from 'vitest';
import {
  mpsToMph, metersToMiles, fmtDuration, fmtScore,
  haversine, clamp, pct, linMap,
} from '../utils/math.js';

describe('mpsToMph', () => {
  it('converts 0 m/s to 0 mph', () => expect(mpsToMph(0)).toBe(0));
  it('converts highway speed', () => expect(mpsToMph(26.82)).toBeCloseTo(60, 0));
});

describe('metersToMiles', () => {
  it('converts 1609 m to ~1 mile', () => expect(metersToMiles(1609.344)).toBeCloseTo(1, 4));
  it('handles 0', () => expect(metersToMiles(0)).toBe(0));
});

describe('fmtDuration', () => {
  it('formats 90 seconds as 1:30', () => expect(fmtDuration(90000)).toBe('1:30'));
  it('formats 0 ms as 0:00', () => expect(fmtDuration(0)).toBe('0:00'));
  it('pads single-digit seconds', () => expect(fmtDuration(65000)).toBe('1:05'));
  it('handles negative (clamps to 0)', () => expect(fmtDuration(-1000)).toBe('0:00'));
});

describe('fmtScore', () => {
  it('rounds to integer', () => expect(fmtScore(87.6)).toBe(88));
  it('clamps at 100', () => expect(fmtScore(105)).toBe(100));
  it('clamps at 0', () => expect(fmtScore(-5)).toBe(0));
  it('handles exact 0', () => expect(fmtScore(0)).toBe(0));
  it('handles exact 100', () => expect(fmtScore(100)).toBe(100));
});

describe('clamp', () => {
  it('leaves in-range value unchanged', () => expect(clamp(50, 0, 100)).toBe(50));
  it('clamps below min', () => expect(clamp(-10, 0, 100)).toBe(0));
  it('clamps above max', () => expect(clamp(110, 0, 100)).toBe(100));
});

describe('haversine', () => {
  it('returns 0 for same point', () => {
    expect(haversine({ lat: 40, lon: -74 }, { lat: 40, lon: -74 })).toBe(0);
  });
  it('returns ~111km per degree of latitude', () => {
    const dist = haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    expect(dist).toBeCloseTo(111195, -2);
  });
});

describe('pct', () => {
  it('returns 50th percentile of [0,100]', () => expect(pct([0, 100], 50)).toBe(50));
  it('returns first element for empty-like array', () => expect(pct([42], 99)).toBe(42));
  it('returns 0 for empty array', () => expect(pct([], 50)).toBe(0));
});

describe('linMap', () => {
  it('maps midpoint correctly', () => expect(linMap(5, 0, 10, 0, 100)).toBe(50));
  it('clamps below input range', () => expect(linMap(-5, 0, 10, 0, 100)).toBe(0));
  it('clamps above input range', () => expect(linMap(15, 0, 10, 0, 100)).toBe(100));
});
