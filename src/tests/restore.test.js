import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cloudRowToDrive } from '../services/supabase.js';
import { saveDrives, loadDrives, recomputeLifetimeScore, loadLifetimeScore } from '../services/storage.js';
import { mergeCloudDrives } from '../services/drive.js';
import { STORAGE_KEY } from '../constants.js';

const cloudRow = (t, over = {}) => ({
  start_time: t, duration_ms: 600000, distance_meters: 8000, top_speed_mps: 24,
  score: 88, event_count: 2, simulated: false,
  dest_label: null, dest_lat: null, dest_lng: null,
  route_distance_m: null, target_eta_sec: null, effectiveness: null, ...over,
});

beforeEach(() => { localStorage.clear(); });

describe('cloudRowToDrive', () => {
  it('maps snake_case cloud columns onto the local drive shape', () => {
    const d = cloudRowToDrive(cloudRow(1000));
    expect(d).toMatchObject({
      startTime: 1000, durationMs: 600000, distanceMeters: 8000,
      topSpeedMps: 24, score: 88, eventCount: 2, restored: true,
    });
    // Restored drives carry no GPS track — that's the whole point of the design.
    expect(d.samples).toEqual([]);
    expect(d.events).toEqual([]);
  });

  it('reconstructs the destination object only when there was one', () => {
    expect(cloudRowToDrive(cloudRow(1)).destination).toBeNull();
    expect(cloudRowToDrive(cloudRow(1, { dest_label: 'Boulder, CO', dest_lat: 40, dest_lng: -105 })).destination)
      .toEqual({ label: 'Boulder, CO', lat: 40, lng: -105 });
  });
});

describe('mergeCloudDrives', () => {
  it('adds cloud drives that are not already local', () => {
    const r = mergeCloudDrives([cloudRow(3000), cloudRow(2000)]);
    expect(r.added).toBe(2);
    expect(loadDrives()).toHaveLength(2);
  });

  it('never clobbers a local drive that still has its GPS samples', () => {
    const localDrive = { startTime: 2000, score: 91, samples: [{ t: 0 }, { t: 1 }], events: [{ type: 'brake' }] };
    saveDrives([localDrive]);
    const r = mergeCloudDrives([cloudRow(2000, { score: 55 }), cloudRow(1000)]);
    expect(r.added).toBe(1);      // only the genuinely new one
    expect(r.skipped).toBe(1);    // the duplicate was left alone
    const kept = loadDrives().find(d => d.startTime === 2000);
    expect(kept.score).toBe(91);            // local score preserved
    expect(kept.samples).toHaveLength(2);   // local samples preserved
  });

  it('returns newest-first order after merging', () => {
    mergeCloudDrives([cloudRow(1000), cloudRow(5000), cloudRow(3000)]);
    expect(loadDrives().map(d => d.startTime)).toEqual([5000, 3000, 1000]);
  });

  it('is a no-op for empty or invalid input', () => {
    expect(mergeCloudDrives([]).added).toBe(0);
    expect(mergeCloudDrives(null).added).toBe(0);
  });

  it('is idempotent — restoring twice does not duplicate', () => {
    const rows = [cloudRow(1000), cloudRow(2000)];
    mergeCloudDrives(rows);
    const second = mergeCloudDrives(rows);
    expect(second.added).toBe(0);
    expect(loadDrives()).toHaveLength(2);
  });
});

describe('saveDrives quota handling', () => {
  it('sheds GPS samples oldest-first rather than losing the whole write', () => {
    const big = n => ({ startTime: n, score: 90, samples: new Array(50).fill({ t: 0, lat: 1, lon: 1 }) });
    const drives = [big(3000), big(2000), big(1000)];

    // Reject the first (full) write, accept once something has been shed.
    const real = localStorage.setItem.bind(localStorage);
    let calls = 0;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v) => {
      if (k === STORAGE_KEY && calls++ === 0){
        const err = new Error('QuotaExceededError'); err.name = 'QuotaExceededError'; throw err;
      }
      return real(k, v);
    });

    expect(saveDrives(drives)).toBe(true);
    spy.mockRestore();

    const saved = loadDrives();
    expect(saved).toHaveLength(3);                         // nothing lost
    expect(saved[2].samples).toEqual([]);                  // oldest shed first
    expect(saved[2].samplesDropped).toBe(true);
    expect(saved[0].samples).toHaveLength(50);             // newest kept intact
  });
});

describe('recomputeLifetimeScore', () => {
  it('averages the 10 most recent scores after a restore', () => {
    saveDrives([{ startTime: 3, score: 100 }, { startTime: 2, score: 80 }, { startTime: 1, score: 60 }]);
    recomputeLifetimeScore();
    expect(loadLifetimeScore()).toBe(80);
  });
});
