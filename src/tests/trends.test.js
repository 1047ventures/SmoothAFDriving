import { describe, it, expect } from 'vitest';
import { buildSeries, trendDirection, toPolyline, METRICS, TREND_WINDOW } from '../services/trends.js';

const drive = (over = {}) => ({
  ts: 1_700_000_000_000,
  score: 80,
  distanceMeters: 1609.344,
  events: [],
  ...over,
});
const ev = (type, n) => Array.from({ length: n }, () => ({ type }));

describe('buildSeries', () => {
  it('returns time running left to right, not newest-first', () => {
    // Drives are stored newest-first; a chart read left-to-right is the reverse.
    // Getting this backwards draws every trend upside down and still looks
    // plausible, which is why it is asserted rather than eyeballed.
    const drives = [drive({ score: 90, ts: 3 }), drive({ score: 80, ts: 2 }), drive({ score: 70, ts: 1 })];
    const s = buildSeries(drives, 'score');
    expect(s.points.map(p => p.value)).toEqual([70, 80, 90]);
  });

  it('counts harsh events by type', () => {
    const d = drive({ events: [...ev('brake', 3), ...ev('accel', 2), ...ev('turn', 1)] });
    expect(buildSeries([d], 'braking').points[0].value).toBe(3);
    expect(buildSeries([d], 'accel').points[0].value).toBe(2);
    expect(buildSeries([d], 'turns').points[0].value).toBe(1);
  });

  it('converts distance to miles', () => {
    expect(buildSeries([drive({ distanceMeters: 1609.344 })], 'miles').points[0].value).toBeCloseTo(1, 3);
  });

  it('drops drives with no value rather than plotting them as zero', () => {
    // A recovered drive keeps no samples, so it has no stop count. Charting
    // that as 0 invents a flawless drive that never happened.
    const drives = [drive({ fullStops: 4 }), drive({ fullStops: undefined }), drive({ fullStops: 2 })];
    const s = buildSeries(drives, 'stops');
    expect(s.points.map(p => p.value)).toEqual([2, 4]);
    expect(s.summary.count).toBe(2);
  });

  it('looks back no further than the window', () => {
    const drives = Array.from({ length: 50 }, (_, i) => drive({ score: i }));
    expect(buildSeries(drives, 'score').points).toHaveLength(TREND_WINDOW);
  });

  it('summarises best in the right direction for each metric', () => {
    const drives = [drive({ score: 60 }), drive({ score: 95 })];
    expect(buildSeries(drives, 'score').summary.best).toBe(95);      // higher wins

    const braky = [drive({ events: ev('brake', 9) }), drive({ events: ev('brake', 1) })];
    expect(buildSeries(braky, 'braking').summary.best).toBe(1);      // lower wins
  });

  it('returns an empty series rather than throwing on no history', () => {
    expect(buildSeries([], 'score').points).toEqual([]);
    expect(buildSeries(undefined, 'score').points).toEqual([]);
  });

  it('returns null for a metric that does not exist', () => {
    expect(buildSeries([drive()], 'horsepower')).toBe(null);
  });
});

describe('trendDirection', () => {
  it('says nothing with fewer than four drives', () => {
    expect(trendDirection([1, 9], false)).toBe('flat');
    expect(trendDirection([1, 2, 3], false)).toBe('flat');
  });

  it('reads a rising score as improving', () => {
    expect(trendDirection([70, 72, 88, 90], false)).toBe('improving');
  });

  it('reads rising hard-braking as worsening', () => {
    // The direction flips with lowerIsBetter. Getting this wrong congratulates
    // a driver for braking harder.
    expect(trendDirection([1, 1, 8, 9], true)).toBe('worsening');
    expect(trendDirection([8, 9, 1, 1], true)).toBe('improving');
  });

  it('treats sub-5% movement as noise', () => {
    expect(trendDirection([100, 100, 102, 102], false)).toBe('flat');
  });

  it('is not flipped by one atypical drive at the end', () => {
    // First-vs-last comparison would call this a collapse because of a single
    // trip. Half-vs-half should not.
    expect(trendDirection([90, 92, 91, 93, 92, 40], false)).not.toBe('improving');
    expect(trendDirection([90, 92, 91, 93, 92, 91], false)).toBe('flat');
  });
});

describe('toPolyline', () => {
  it('spans the box, oldest on the left', () => {
    const s = buildSeries([drive({ score: 100 }), drive({ score: 0 })], 'score');
    const pts = toPolyline(s, 100, 50, 0).split(' ').map(p => p.split(',').map(Number));
    expect(pts[0][0]).toBe(0);     // first point at the left edge
    expect(pts[1][0]).toBe(100);   // last at the right
    expect(pts[0][1]).toBe(50);    // score 0 → bottom (y grows downward)
    expect(pts[1][1]).toBe(0);     // score 100 → top
  });

  it('centres a flat series instead of dividing by zero', () => {
    const s = buildSeries([drive({ score: 80 }), drive({ score: 80 })], 'score');
    const line = toPolyline(s, 100, 50, 0);
    expect(line).not.toContain('NaN');
    expect(line.split(' ').every(p => p.endsWith(',25.0'))).toBe(true);
  });

  it('places a single point mid-box rather than at an edge', () => {
    const s = buildSeries([drive({ score: 80 })], 'score');
    expect(toPolyline(s, 100, 50, 0)).toBe('50.0,25.0');
  });

  it('returns an empty string for an empty series', () => {
    expect(toPolyline({ points: [] }, 100, 50)).toBe('');
    expect(toPolyline(null, 100, 50)).toBe('');
  });
});

describe('METRICS', () => {
  it('marks harsh-event metrics as lower-is-better and score as higher', () => {
    expect(METRICS.braking.lowerIsBetter).toBe(true);
    expect(METRICS.accel.lowerIsBetter).toBe(true);
    expect(METRICS.turns.lowerIsBetter).toBe(true);
    expect(METRICS.stops.lowerIsBetter).toBe(true);
    expect(METRICS.score.lowerIsBetter).toBe(false);
    expect(METRICS.miles.lowerIsBetter).toBe(false);
  });
});
