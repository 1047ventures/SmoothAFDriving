import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage for Node environment
const store = {};
const localStorageMock = {
  getItem:    key => store[key] ?? null,
  setItem:    (key, val) => { store[key] = String(val); },
  removeItem: key => { delete store[key]; },
  clear:      () => Object.keys(store).forEach(k => delete store[k]),
};
vi.stubGlobal('localStorage', localStorageMock);

// Import after stubbing globals
const { loadLifetimeScore, saveLifetimeScore, loadDrives, saveDrive, saveDrives,
        loadDriverName, saveDriverName, migrateLifetimeScore,
        toggleFavoriteDrive, deleteDrive, getOsmLimit, setOsmLimit,
} = await import('../services/storage.js');
const { OSM_CACHE_TTL, OSM_SPEED_CACHE, OSM_CACHE_MAX } = await import('../constants.js');

beforeEach(() => localStorageMock.clear());

describe('loadLifetimeScore', () => {
  it('returns 100 when nothing stored', () => expect(loadLifetimeScore()).toBe(100));
  it('returns stored value', () => {
    saveLifetimeScore(87);
    expect(loadLifetimeScore()).toBe(87);
  });
  it('rounds to integer on save', () => {
    saveLifetimeScore(87.6);
    expect(loadLifetimeScore()).toBe(88);
  });
});

describe('loadDriverName', () => {
  it('returns empty string when not set', () => expect(loadDriverName()).toBe(''));
  it('returns stored name', () => {
    saveDriverName('Alex');
    expect(loadDriverName()).toBe('Alex');
  });
  it('trims whitespace on save', () => {
    saveDriverName('  Jo  ');
    expect(loadDriverName()).toBe('Jo');
  });
});

describe('loadDrives / saveDrive', () => {
  it('returns empty array when nothing stored', () => expect(loadDrives()).toEqual([]));

  it('prepends a drive', () => {
    const drive = { startTime: 1000, score: 90, distanceMeters: 1000 };
    saveDrive(drive);
    const drives = loadDrives();
    expect(drives).toHaveLength(1);
    expect(drives[0].score).toBe(90);
  });

  it('newest drive is first', () => {
    saveDrive({ startTime: 1000, score: 80 });
    saveDrive({ startTime: 2000, score: 90 });
    const drives = loadDrives();
    expect(drives[0].startTime).toBe(2000);
  });
});

describe('migrateLifetimeScore', () => {
  it('sets 100 when no drives and no score', () => {
    migrateLifetimeScore();
    expect(loadLifetimeScore()).toBe(100);
  });

  it('re-derives score from drives when stored value is 0', () => {
    saveLifetimeScore(0);
    saveDrive({ startTime: 1000, score: 85, distanceMeters: 1000 });
    saveDrive({ startTime: 2000, score: 90, distanceMeters: 1000 });
    migrateLifetimeScore();
    const score = loadLifetimeScore();
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('does NOT overwrite a valid non-zero stored score', () => {
    saveLifetimeScore(75);
    saveDrive({ startTime: 1000, score: 50, distanceMeters: 1000 });
    migrateLifetimeScore();
    expect(loadLifetimeScore()).toBe(75);
  });
});

describe('toggleFavoriteDrive', () => {
  it('stars an unstared drive and calls onUpdate', () => {
    saveDrive({ startTime: 1000, score: 80, starred: false });
    const onUpdate = vi.fn();
    toggleFavoriteDrive(0, { onUpdate });
    expect(loadDrives()[0].starred).toBe(true);
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it('unstars a starred drive', () => {
    saveDrive({ startTime: 1000, score: 80, starred: true });
    toggleFavoriteDrive(0, {});
    expect(loadDrives()[0].starred).toBe(false);
  });
});

describe('deleteDrive', () => {
  it('removes drive at index and calls onUpdate', () => {
    saveDrive({ startTime: 1000, score: 80 });
    saveDrive({ startTime: 2000, score: 90 });
    const onUpdate = vi.fn();
    deleteDrive(0, { onUpdate }); // removes newest (idx 0)
    expect(loadDrives()).toHaveLength(1);
    expect(onUpdate).toHaveBeenCalledOnce();
  });
});

describe('OSM speed-limit cache', () => {
  it('returns null when nothing cached', () => {
    expect(getOsmLimit(37.421, -122.084)).toBeNull();
  });

  it('stores and retrieves a limit', () => {
    setOsmLimit(37.421, -122.084, 13.4);
    expect(getOsmLimit(37.421, -122.084)).toBeCloseTo(13.4);
  });

  it('rounds to 3 decimal places (same ~110m cell)', () => {
    setOsmLimit(37.4211, -122.0841, 8.9);
    // 37.4211 and 37.4214 both round to "37.421"; -122.0841 and -122.0844 both round to "-122.084"
    expect(getOsmLimit(37.4214, -122.0844)).toBeCloseTo(8.9);
  });

  it('returns null for expired entries', () => {
    const expiredCache = { '37.500_-122.000': { limitMps: 20, ts: Date.now() - OSM_CACHE_TTL - 1000 } };
    store[OSM_SPEED_CACHE] = JSON.stringify(expiredCache);
    expect(getOsmLimit(37.500, -122.000)).toBeNull();
  });

  it('evicts the oldest entry when cache exceeds max size', () => {
    // Pre-populate exactly OSM_CACHE_MAX entries with staggered timestamps (1s apart)
    const cache = {};
    const baseTs = Date.now() - OSM_CACHE_MAX * 1000;
    for (let i = 0; i < OSM_CACHE_MAX; i++) {
      // lat rounds to e.g. "51.000" … "51.499" — well clear of test coords elsewhere
      const lat = (51 + i * 0.001).toFixed(3);
      cache[`${lat}_0.000`] = { limitMps: 10, ts: baseTs + i * 1000 };
    }
    store[OSM_SPEED_CACHE] = JSON.stringify(cache);

    // Adding one more entry (501st) should trigger eviction of the oldest
    setOsmLimit(52.000, 0.000, 20);

    const after = JSON.parse(store[OSM_SPEED_CACHE]);
    expect(Object.keys(after).length).toBeLessThanOrEqual(OSM_CACHE_MAX);
    // "51.000_0.000" was the oldest (ts = baseTs) and should be gone
    expect(after['51.000_0.000']).toBeUndefined();
    // The newly added entry should survive
    expect(after['52.000_0.000']).toBeDefined();
  });
});
