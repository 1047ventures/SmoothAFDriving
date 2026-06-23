import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = {};
vi.stubGlobal('localStorage', {
  getItem:    k => store[k] ?? null,
  setItem:    (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
  clear:      () => Object.keys(store).forEach(k => delete store[k]),
});

const { loadCorridors, saveCorridors, upsertCorridorDrive } = await import('../services/storage.js');

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
  it('generates a stable slugified corridorId', () => {
    upsertCorridorDrive({ name: 'N Wadsworth Blvd', city: 'Denver', centerLat: 39.74, centerLon: -105.07, osmWayId: 123, score: 82, distanceMeters: 1200, drivenAt: 1000 });
    expect(loadCorridors()[0].corridorId).toBe('n-wadsworth-blvd-denver');
  });
});
