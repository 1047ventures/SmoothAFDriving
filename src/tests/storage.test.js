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
        toggleFavoriteDrive, deleteDrive,
} = await import('../services/storage.js');

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
