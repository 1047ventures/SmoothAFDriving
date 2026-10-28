import { describe, it, expect, beforeEach } from 'vitest';
import { backfillTypicalTraffic, needsTraffic, tripEnds } from '../services/trafficBackfill.js';
import { nextSameSlot, nextQuietTime } from '../services/routing.js';
import { loadDrives, saveDrives } from '../services/storage.js';

// ~2.6 km straight north, smooth cruising.
const track = Array.from({ length: 120 }, (_, i) => ({ t: i * 1000, lat: 39.70 + i * 0.0002, lon: -104.9, speed: 13, h: 0.3, la: 0.05, ra: 0.03 }));
const DAY = 864e5;
const now = Date.parse('2026-10-28T12:00:00');
const drive = (over = {}) => ({ startTime: now - 3 * DAY, durationMs: 120000, distanceMeters: 2600, score: 80, efficiency: 80, samples: track, events: [], ...over });

beforeEach(() => localStorage.clear());

describe('typical-traffic backfill', () => {
  it('only picks finished, real drives with no traffic yet', () => {
    expect(needsTraffic(drive(), now)).toBe(true);
    expect(needsTraffic(drive({ traffic: null }), now)).toBe(false);
    expect(needsTraffic(drive({ simulated: true }), now)).toBe(false);
    expect(needsTraffic(drive({ samples: [] }), now)).toBe(false);
    expect(needsTraffic(drive({ startTime: now - 60000 }), now)).toBe(false);   // the live read owns it
  });
  it('skips loops that end where they started', () => {
    expect(tripEnds(drive({ samples: [track[0], track[1], track[0]] }))).toBeNull();
    expect(tripEnds(drive())).not.toBeNull();
  });
  it('stamps an estimate and rescores, without touching other drives', async () => {
    saveDrives([drive({ startTime: now - 3 * DAY }), drive({ startTime: now - 2 * DAY, traffic: { ratio: 1.1, base: '3am' } })]);
    const calls = [];
    const r = await backfillTypicalTraffic({ now, fetchRatio: async (a, b, when) => { calls.push(when); return { ratio: 1.8, trafficSec: 900, freeSec: 500, base: '3am' }; } });
    expect(calls).toEqual([now - 3 * DAY]);
    expect(r.estimated).toBe(1);
    const [a, b] = loadDrives().sort((x, y) => x.startTime - y.startTime);
    expect(a.traffic).toMatchObject({ ratio: 1.8, estimated: true });
    expect(a.dims.trafficBonus).not.toBe(0);
    expect(b.traffic).toEqual({ ratio: 1.1, base: '3am' });
  });
  it('retries a failed lookup a few launches, then gives up', async () => {
    saveDrives([drive()]);
    const fail = { now, fetchRatio: async () => null };
    await backfillTypicalTraffic(fail);
    expect(loadDrives()[0].traffic).toBeUndefined();
    await backfillTypicalTraffic(fail); await backfillTypicalTraffic(fail);
    expect(loadDrives()[0].traffic).toBeNull();
  });
  it('treats very short trips as noise', async () => {
    saveDrives([drive()]);
    await backfillTypicalTraffic({ now, fetchRatio: async () => ({ ratio: 1.7, trafficSec: 150, freeSec: 90, base: '3am' }) });
    expect(loadDrives()[0].traffic).toBeNull();
  });
  it('re-estimates a live reading taken on the old midday yardstick', () => {
    expect(needsTraffic(drive({ traffic: { ratio: 1.17 } }), now)).toBe(true);
    expect(needsTraffic(drive({ traffic: { ratio: 1.6, base: '3am' } }), now)).toBe(false);
  });
});

describe('traffic times', () => {
  it('next 3am is in the future', () => {
    const q = nextQuietTime(new Date('2026-10-28T12:00:00'));
    expect(q.getHours()).toBe(3);
    expect(q > new Date('2026-10-28T12:00:00')).toBe(true);
  });
  it('same weekday and time, at least an hour out', () => {
    const when = new Date('2026-10-22T17:15:00');           // a Thursday
    const s = nextSameSlot(when, new Date('2026-10-28T12:00:00'));  // a Wednesday
    expect([s.getDay(), s.getHours(), s.getMinutes()]).toEqual([4, 17, 15]);
    expect(s.getDate()).toBe(29);
    const soon = nextSameSlot(new Date('2026-10-21T12:30:00'), new Date('2026-10-28T12:00:00'));
    expect(soon.getDate()).toBe(4);                          // 30 min away → next week
    const tomorrowish = nextSameSlot(new Date('2026-10-22T10:00:00'), new Date('2026-10-28T12:00:00'));
    expect(tomorrowish.getDate()).toBe(5);                   // 22h away is too close to be 'usual' → next week
  });
});
