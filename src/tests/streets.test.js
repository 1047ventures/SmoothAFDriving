import { describe, it, expect, vi } from 'vitest';
const store = {};
vi.stubGlobal('localStorage', { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } });
const { distToSegment, nearestStreet, placeFor, eventKey, resolveEventStreets } = await import('../services/streets.js');

const M = 111111, LAT0 = 39.7, LON0 = -104.9;
const K = Math.cos(LAT0 * Math.PI / 180);
// x metres east, y metres north of the intersection of Federal (N–S) and 6th (E–W).
const pt = (x, y) => ({ lat: LAT0 + y / M, lon: LON0 + x / (M * K) });
const federal = { name: 'Federal Boulevard', pts: [pt(0, -400), pt(0, 400)] };
const sixth   = { name: 'West 6th Avenue',   pts: [pt(-400, 0), pt(400, 0)] };
const ways = [federal, sixth];

// 1 Hz track: north on Federal (y -120 → 0), then east on 6th (x 0 → 120).
const track = [];
for (let y = -120, t = 0; y <= 0; y += 10, t += 1000) track.push({ ...pt(0, y), t });
for (let x = 10, t = 13000; x <= 120; x += 10, t += 1000) track.push({ ...pt(x, 0), t });
const turnT = 12000;   // at the intersection

describe('distToSegment / nearestStreet', () => {
  it('measures perpendicular distance in metres', () => {
    expect(distToSegment(pt(10, 50), pt(0, -400), pt(0, 400))).toBeCloseTo(10, 0);
    expect(distToSegment(pt(0, 500), pt(0, -400), pt(0, 400))).toBeCloseTo(100, 0);   // clamps to the end
  });
  it('picks the closest named road within range, else null', () => {
    expect(nearestStreet(pt(8, 100), ways)).toBe('Federal Boulevard');
    expect(nearestStreet(pt(100, 6), ways)).toBe('West 6th Avenue');
    expect(nearestStreet(pt(200, 200), ways)).toBeNull();
  });
  it('falls back to the route number when a road has no name; ignores unlabelled ways', () => {
    expect(nearestStreet(pt(3, 0), [{ ref: 'US 6', pts: [pt(0, -50), pt(0, 50)] }])).toBe('US 6');
    expect(nearestStreet(pt(3, 0), [{ pts: [pt(0, -50), pt(0, 50)] }])).toBeNull();
  });
});

describe('placeFor', () => {
  it('a turn from Federal onto 6th says "onto West 6th Avenue"', () => {
    const e = { type: 'turn', t: turnT, ...pt(2, 0) };
    expect(placeFor(e, track, ways)).toEqual({ street: 'West 6th Avenue', kind: 'onto' });
  });
  it('a hard brake on Federal says "on Federal Boulevard"', () => {
    const e = { type: 'brake', t: 6000, ...pt(0, -60) };
    expect(placeFor(e, track, ways)).toEqual({ street: 'Federal Boulevard', kind: 'on' });
  });
  it('a curve that stays on the same road says "on", not "onto"', () => {
    const straight = [];
    for (let y = -120, t = 0; y <= 120; y += 10, t += 1000) straight.push({ ...pt(0, y), t });
    const e = { type: 'turn', t: 12000, ...pt(0, 0) };
    expect(placeFor(e, straight, [federal])).toEqual({ street: 'Federal Boulevard', kind: 'on' });
  });
  it('no named road nearby, or no position, means no wording', () => {
    expect(placeFor({ type: 'brake', t: 0, ...pt(500, 500) }, track, ways)).toBeNull();
    expect(placeFor({ type: 'brake', t: 0 }, track, ways)).toBeNull();
  });
  it('a turn right at the end of the track still names the road (nothing ahead to read)', () => {
    const e = { type: 'turn', t: 24000, ...pt(120, 0) };
    expect(placeFor(e, track, ways)?.street).toBe('West 6th Avenue');
  });
});

describe('resolveEventStreets', () => {
  const overpass = {
    elements: ways.map((w, i) => ({ type: 'way', id: i + 1, tags: { name: w.name, highway: 'primary' },
      geometry: w.pts.map(p => ({ lat: p.lat, lon: p.lon })) })),
  };
  const ok = () => vi.fn().mockResolvedValue({ ok: true, json: async () => overpass });
  const e = { type: 'turn', t: turnT, ...pt(2, 0) };

  it('queries named roads around the event and returns wording keyed by event', async () => {
    const f = ok();
    const places = await resolveEventStreets('d1', track, [e], { fetchImpl: f });
    expect(places[eventKey(e)]).toEqual({ street: 'West 6th Avenue', kind: 'onto' });
    const body = decodeURIComponent(f.mock.calls[0][1].body);
    expect(body).toContain('way["highway"~');
    expect(body).toContain('out tags geom');
  });
  it('is cached per drive — a second call makes no request', async () => {
    const f = ok();
    await resolveEventStreets('d2', track, [e], { fetchImpl: f });
    const again = vi.fn();
    await resolveEventStreets('d2', track, [e], { fetchImpl: again });
    expect(again).not.toHaveBeenCalled();
  });
  it('fails soft: every mirror down gives null, an empty event list gives {}', async () => {
    expect(await resolveEventStreets('d3', track, [e], { fetchImpl: vi.fn().mockRejectedValue(new Error('offline')) })).toBeNull();
    expect(await resolveEventStreets('d4', track, [], { fetchImpl: vi.fn() })).toEqual({});
  });
  it('tries the second mirror when the first refuses', async () => {
    const f = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, json: async () => overpass });
    const places = await resolveEventStreets('d5', track, [e], { fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(2);
    expect(places[eventKey(e)].street).toBe('West 6th Avenue');
  });
});
