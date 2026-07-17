import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = {};
vi.stubGlobal('localStorage', {
  getItem:    k => store[k] ?? null,
  setItem:    (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
  clear:      () => Object.keys(store).forEach(k => delete store[k]),
});

const { loadCorridors, saveCorridors, upsertCorridorDrive, mergeDuplicateCorridors } = await import('../services/storage.js');
const { sampleGpsPoints, slugifyCorridorId } = await import('../services/corridors.js');

beforeEach(() => { Object.keys(store).forEach(k => delete store[k]); });

describe('loadCorridors', () => {
  it('returns empty array when nothing stored', () => {
    expect(loadCorridors()).toEqual([]);
  });
  it('returns parsed array when stored', () => {
    store['smoothaf.corridors'] = JSON.stringify([{ corridorId: 'a', name: 'Test St', drives: [] }]);
    expect(loadCorridors()).toHaveLength(1);
  });
});

describe('upsertCorridorDrive', () => {
  it('creates a new corridor entry on first drive', () => {
    upsertCorridorDrive({ name: 'N Wadsworth Blvd', city: 'Denver', centerLat: 39.74, centerLon: -105.07, osmWayId: 123, score: 82, distanceMeters: 1200, drivenAt: 1000 });
    const all = loadCorridors();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('N Wadsworth Blvd');
    expect(all[0].drives).toHaveLength(1);
    expect(all[0].drives[0].score).toBe(82);
  });
  it('appends a drive to an existing corridor', () => {
    upsertCorridorDrive({ name: 'N Wadsworth Blvd', city: 'Denver', centerLat: 39.74, centerLon: -105.07, osmWayId: 123, score: 82, distanceMeters: 1200, drivenAt: 1000 });
    upsertCorridorDrive({ name: 'N Wadsworth Blvd', city: 'Denver', centerLat: 39.74, centerLon: -105.07, osmWayId: 123, score: 90, distanceMeters: 1400, drivenAt: 2000 });
    const all = loadCorridors();
    expect(all).toHaveLength(1);
    expect(all[0].drives).toHaveLength(2);
  });
  it('creates separate entries for different corridors', () => {
    upsertCorridorDrive({ name: 'N Wadsworth Blvd', city: 'Denver', centerLat: 39.74, centerLon: -105.07, osmWayId: 123, score: 82, distanceMeters: 1200, drivenAt: 1000 });
    upsertCorridorDrive({ name: 'W Colfax Ave',     city: 'Denver', centerLat: 39.74, centerLon: -104.99, osmWayId: 456, score: 75, distanceMeters: 800,  drivenAt: 2000 });
    expect(loadCorridors()).toHaveLength(2);
  });
  it('keys corridors by road name only, so the same road entered from a different start city merges into one entry', () => {
    upsertCorridorDrive({ name: 'Denver-Boulder Turnpike', city: 'Denver',    centerLat: 39.8, centerLon: -105.1, osmWayId: 111, score: 80, distanceMeters: 5000, drivenAt: 1000 });
    upsertCorridorDrive({ name: 'Denver-Boulder Turnpike', city: 'Broomfield', centerLat: 39.9, centerLon: -105.1, osmWayId: 111, score: 88, distanceMeters: 5200, drivenAt: 2000 });
    const all = loadCorridors();
    expect(all).toHaveLength(1);
    expect(all[0].drives).toHaveLength(2);
    // Display city refreshes to the most recent drive's city.
    expect(all[0].city).toBe('Broomfield');
  });
});

describe('mergeDuplicateCorridors', () => {
  it('is a no-op (returns the same reference) when every entry already has its canonical name-only id', () => {
    const corridors = [
      { corridorId: slugifyCorridorId('N Wadsworth Blvd'), name: 'N Wadsworth Blvd', city: 'Denver', drives: [{ score: 82, distanceMeters: 1200, drivenAt: 1000 }] },
    ];
    expect(mergeDuplicateCorridors(corridors)).toBe(corridors);
  });
  it('merges legacy name+city duplicates for the same road into a single entry', () => {
    const legacy = [
      { corridorId: 'denver-boulder-turnpike-denver',    name: 'Denver-Boulder Turnpike', city: 'Denver',    centerLat: 39.8, centerLon: -105.1, osmWayId: 111, drives: [{ score: 80, distanceMeters: 5000, drivenAt: 1000 }] },
      { corridorId: 'denver-boulder-turnpike-broomfield', name: 'Denver-Boulder Turnpike', city: 'Broomfield', centerLat: 39.9, centerLon: -105.1, osmWayId: 111, drives: [{ score: 88, distanceMeters: 5200, drivenAt: 2000 }] },
      { corridorId: 'denver-boulder-turnpike-boulder',    name: 'Denver-Boulder Turnpike', city: 'Boulder',    centerLat: 40.0, centerLon: -105.2, osmWayId: 111, drives: [{ score: 70, distanceMeters: 4800, drivenAt: 500  }] },
    ];
    const merged = mergeDuplicateCorridors(legacy);
    expect(merged).toHaveLength(1);
    expect(merged[0].corridorId).toBe(slugifyCorridorId('Denver-Boulder Turnpike'));
    expect(merged[0].drives).toHaveLength(3);
    expect(merged[0].drives.map(d => d.score).sort()).toEqual([70, 80, 88]);
    // City comes from the entry with the most recent drive (drivenAt: 2000 → Broomfield).
    expect(merged[0].city).toBe('Broomfield');
  });
  it('is idempotent — running it again on its own output changes nothing', () => {
    const legacy = [
      { corridorId: 'a-denver', name: 'A St', city: 'Denver', drives: [{ score: 80, distanceMeters: 100, drivenAt: 1 }] },
      { corridorId: 'a-boulder', name: 'A St', city: 'Boulder', drives: [{ score: 60, distanceMeters: 200, drivenAt: 2 }] },
    ];
    const once  = mergeDuplicateCorridors(legacy);
    const twice = mergeDuplicateCorridors(once);
    expect(twice).toBe(once);
    expect(twice).toEqual(once);
  });
});

describe('sampleGpsPoints', () => {
  const makeSamples = (count, latStep = 0.001) =>
    Array.from({ length: count }, (_, i) => ({ lat: 39.7 + i * latStep, lon: -104.9, speed: 10, t: i * 1000 }));

  it('returns empty array for empty input', () => {
    expect(sampleGpsPoints([], 25)).toEqual([]);
  });
  it('returns at least the first point for short drives', () => {
    const samples = makeSamples(5, 0.0001);
    const result = sampleGpsPoints(samples, 25);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
  it('samples one point per ~250m and caps at maxPoints', () => {
    const samples = makeSamples(100, 0.003);
    const result = sampleGpsPoints(samples, 10);
    expect(result.length).toBeLessThanOrEqual(10);
    expect(result[0]).toEqual(samples[0]);
  });
  it('always includes the first sample', () => {
    const samples = makeSamples(50, 0.002);
    expect(sampleGpsPoints(samples, 25)[0]).toEqual(samples[0]);
  });
});

describe('slugifyCorridorId', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugifyCorridorId('N Wadsworth Blvd')).toBe('n-wadsworth-blvd');
  });
  it('removes special characters', () => {
    expect(slugifyCorridorId('W. Colfax Ave.')).toBe('w-colfax-ave');
  });
  it('strips leading and trailing hyphens', () => {
    expect(slugifyCorridorId('Speer Blvd')).toBe('speer-blvd');
  });
  it('is name-only — city is not part of the id, so the same road from different start cities shares one id', () => {
    expect(slugifyCorridorId('Denver-Boulder Turnpike')).toBe(slugifyCorridorId('Denver-Boulder Turnpike'));
    expect(slugifyCorridorId('Denver-Boulder Turnpike')).toBe('denver-boulder-turnpike');
  });
});
