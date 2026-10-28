import { describe, it, expect, beforeEach } from 'vitest';
import { descents, bigHits, driveWear, stampWear, wearWindow } from '../services/carWear.js';
import { drivingContext, maintenance, findings, wearZones, odometerNow, setOdometer, logService, loadCare,
  parseRecalls, fetchRecalls, learnUrl, bookUrl, askText } from '../services/carCare.js';

const DAY = 86_400_000;
const NOW = 1000 * DAY;
const MI = 1609.344;
const brake = (tier) => ({ type: 'brake', tier, t: 1000 });
// A drive `daysAgo`, `mi` long, with `stops` hard stops.
const drive = ({ daysAgo = 1, mi = 10, stops = 0, mins = 20, samples = [], vid = 'car1' } = {}) => {
  const d = { startTime: NOW - daysAgo * DAY, distanceMeters: mi * MI, durationMs: mins * 60_000,
    events: Array.from({ length: stops }, () => brake(2)), samples, vehicleId: vid };
  d.wear = driveWear(d, vid);
  return d;
};

describe('carWear', () => {
  it('finds long downhill runs and ignores small dips', () => {
    const down = [2000, 1950, 1900, 1850, 1820, 1830, 1790].map((al, i) => ({ t: i * 60_000, al }));
    expect(descents(down)).toEqual([{ dropM: 210, t: 6 * 60_000 }]);
    expect(descents([100, 80, 120, 60].map((al, i) => ({ t: i, al })))).toEqual([]);
  });
  it('counts a pothole once, at speed only', () => {
    const s = [
      { t: 0, rj: 16, speed: 15, lat: 1, lon: 2 }, { t: 1000, rj: 18, speed: 15, lat: 1, lon: 2 },   // one hit, two samples
      { t: 20_000, rj: 19, speed: 5, lat: 1, lon: 2 },                                                 // speed bump pace
      { t: 40_000, rj: 12, speed: 20, lat: 1, lon: 2 },                                                 // ordinary road
    ];
    const h = bigHits(s);
    expect(h).toHaveLength(1);
    expect(h[0].mps2).toBe(18);
  });
  it('stamps a drive and tags it to a car, once', () => {
    const d = { distanceMeters: MI * 5, durationMs: 5 * 60_000, events: [brake(1), brake(2), brake(3), { type: 'turn', tier: 3 }] };
    expect(stampWear([d], 'car1')).toBe(true);
    expect(d.wear).toMatchObject({ vid: 'car1', mi: 5, hardStops: 2, hardCorners: 1, short: true, hits: 0 });
    expect(stampWear([d], 'car2')).toBe(false);
  });
  it('sums one car over a window', () => {
    const ds = [drive({ stops: 5 }), drive({ daysAgo: 100, stops: 50 }), drive({ stops: 9, vid: 'other' })];
    const w = wearWindow(ds, 'car1', 90, NOW);
    expect(w).toMatchObject({ drives: 1, hardStops: 5, mi: 10 });
    expect(w.per100('hardStops')).toBe(50);
  });
});

describe('drivingContext + findings', () => {
  it('flags heavy braking against your own usual, with the numbers', () => {
    const old = Array.from({ length: 30 }, (_, i) => drive({ daysAgo: 200 + i, mi: 20, stops: 1 }));   // 5 / 100 mi usual
    const lately = Array.from({ length: 10 }, (_, i) => drive({ daysAgo: 1 + i, mi: 15, stops: 3 }));  // 20 / 100 mi
    const ctx = drivingContext([...old, ...lately], 'car1', NOW);
    expect(ctx.heavyBraking).toBe(true);
    const f = findings(ctx).find(x => x.id === 'brakes-load');
    expect(f.evidence).toContain('30 hard stops in 150 mi');
    expect(f.evidence).toContain('your usual is');
    expect(wearZones(ctx, findings(ctx)).brakes.state).toBe('watch');
  });
  it('says nothing about brakes on gentle driving, and lights them green', () => {
    const ctx = drivingContext(Array.from({ length: 10 }, (_, i) => drive({ daysAgo: i + 1, mi: 15, stops: 0 })), 'car1', NOW);
    expect(findings(ctx).some(x => x.part === 'brakes')).toBe(false);
    expect(wearZones(ctx, []).brakes).toMatchObject({ state: 'good', note: 'Light braking · 3 mo' });
  });
  it('leaves brakes unread with too little driving to judge', () => {
    const ctx = drivingContext([drive({ mi: 10 })], 'car1', NOW);
    expect(wearZones(ctx, []).brakes).toBeUndefined();
  });
  it('flags mostly short trips as severe service', () => {
    const ds = Array.from({ length: 8 }, (_, i) => drive({ daysAgo: i + 1, mi: 2, mins: 6 }));
    const ctx = drivingContext(ds, 'car1', NOW);
    expect(ctx.severe).toBe(true);
    expect(findings(ctx).find(f => f.id === 'short-trips').evidence).toBe('8 of your 8 drives in the last 2 months were under 10 minutes.');
  });
  it('reports a hard hit with when and how fast', () => {
    const d = drive({ samples: [{ t: 5000, rj: 16.7, speed: 17, lat: 39.7, lon: -105 }] });
    const ctx = drivingContext([d], 'car1', NOW);
    const f = findings(ctx).find(x => x.id === 'hits');
    expect(f.evidence).toMatch(/^A 1\.7 g jolt at 38 mph on /);
    expect(wearZones(ctx, findings(ctx)).steering).toMatchObject({ state: 'good', note: '1 hard hit · 3 mo' });   // one hit is advice, not yellow
  });
});

describe('maintenance', () => {
  const t0 = NOW - 100 * DAY;
  it('marks never-logged items unknown, not due', () => {
    expect(maintenance({ log: {} }, { now: NOW }).every(m => m.status === 'unknown')).toBe(true);
  });
  it('times by miles or months, whichever comes first', () => {
    const care = { log: { oil: { mi: 40000, at: t0 }, rotation: { mi: 40000, at: NOW - 200 * DAY } } };
    const m = maintenance(care, { odoNow: 44700, now: NOW });
    expect(m.find(x => x.id === 'oil')).toMatchObject({ status: 'soon', due: 'Due in ~300 mi' });
    expect(m.find(x => x.id === 'rotation')).toMatchObject({ status: 'overdue' });
    expect(m[0].id).toBe('rotation');   // overdue sorts first
  });
  it('shortens oil for severe service and brakes for heavy braking', () => {
    const care = { log: { oil: { mi: 40000, at: t0 }, brakes: { mi: 40000, at: t0 } } };
    const m = maintenance(care, { odoNow: 44000, now: NOW, severe: true, heavyBraking: true });
    expect(m.find(x => x.id === 'oil')).toMatchObject({ status: 'overdue', why: 'Sooner: mostly short trips' });
    expect(m.find(x => x.id === 'brakes').why).toBe('Sooner: heavy braking lately');
  });
  it('calls for an alignment check after a hard hit', () => {
    expect(maintenance({ log: {} }, { now: NOW, hitsSinceAlign: 2 }).find(x => x.id === 'alignment'))
      .toMatchObject({ status: 'soon', due: 'After a hard hit' });
  });
});

describe('odometer + log storage', () => {
  beforeEach(() => localStorage.clear());
  it('adds recorded miles since the anchor', () => {
    setOdometer('car1', 48000, NOW - 10 * DAY);
    const ds = [drive({ daysAgo: 5, mi: 30 }), drive({ daysAgo: 20, mi: 99 })];
    expect(odometerNow(loadCare('car1'), ds, 'car1')).toBe(48030);
    logService('car1', 'oil', 48030, NOW);
    expect(loadCare('car1').log.oil).toEqual({ mi: 48030, at: NOW });
  });
});

describe('recalls', () => {
  const json = { results: [{ NHTSACampaignNumber: '20V314000', Component: 'FUEL SYSTEM, GASOLINE:DELIVERY:FUEL PUMP', Summary: 'S', Remedy: 'R', parkIt: 'False' }] };
  beforeEach(() => localStorage.clear());
  it('parses NHTSA results', () => {
    expect(parseRecalls(json)).toEqual([{ id: '20V314000', component: 'Fuel System · Fuel Pump', summary: 'S', remedy: 'R', date: null, parkIt: false }]);
  });
  it('caches for a week and needs make, model and year', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return { ok: true, json: async () => json }; };
    const car = { make: 'Honda', model: 'Civic', year: '2019' };
    expect(await fetchRecalls(car, { now: NOW, fetchImpl })).toHaveLength(1);
    await fetchRecalls(car, { now: NOW + DAY, fetchImpl });
    expect(calls).toBe(1);
    expect(await fetchRecalls({ make: 'Honda' }, { fetchImpl })).toBeNull();
  });
  it('groups recalls into one card, and drops the ones you have checked', () => {
    const ctx = { w90: { hits: 0 }, heavyBraking: false, severe: false };
    const car = { year: 2019, make: 'Honda', model: 'Civic' };
    const f = findings(ctx, parseRecalls(json), { car });
    expect(f[0]).toMatchObject({ part: 'recall', level: 'act', title: '1 recall on 2019 Honda Civics' });
    expect(f[0].advice).toContain('Check your VIN');
    expect(findings(ctx, parseRecalls(json), { car, checked: ['20V314000'] })).toEqual([]);
  });
});

describe('learn / ask / book', () => {
  const car = { year: 2019, make: 'Honda', model: 'Civic' };
  it('builds links for this exact car', () => {
    expect(learnUrl(car, 'oil change')).toBe('https://www.youtube.com/results?search_query=2019%20Honda%20Civic%20oil%20change');
    expect(bookUrl('brake inspection')).toBe('https://www.google.com/maps/search/brake%20inspection%20near%20me');
    expect(askText(car, { title: 'Heavy braking lately', evidence: 'X.' }, 48210)).toBe(
      'I drive a 2019 Honda Civic with about 48,210 miles. My driving app flagged: Heavy braking lately. X. What should I check, what are the warning signs, and is this a job I can do myself?');
  });
});
