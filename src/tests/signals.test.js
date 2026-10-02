import { describe, it, expect, vi } from 'vitest';
const store = {};
vi.stubGlobal('localStorage', { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } });
const { bearing, headingBefore, classifyStop, classifyStops, countCauses, describeCauses, describeCause, fetchStopFeatures } =
  await import('../services/signals.js');

const M = 111111;
const stop = { lat: 39.7, lon: -104.9 };
// A point `fwd` metres ahead of the stop along `heading` (radians, 0 = north) and `lat` metres to its right.
const at = (heading, fwd, lat = 0) => ({
  lat: stop.lat + (fwd * Math.cos(heading) - lat * Math.sin(heading)) / M,
  lon: stop.lon + (fwd * Math.sin(heading) + lat * Math.cos(heading)) / (M * Math.cos(stop.lat * Math.PI / 180)),
});
const sig = (h, fwd, lat) => ({ ...at(h, fwd, lat), kind: 'signal' });
const stp = (h, fwd, lat) => ({ ...at(h, fwd, lat), kind: 'stop' });

describe('classifyStop — which feature explains a stop', () => {
  for (const [name, h] of [['north', 0], ['east', Math.PI / 2], ['south-west', Math.PI * 1.25], ['north-west', -Math.PI / 4]]){
    it(`a signal 50 m ahead = waiting in its queue (heading ${name})`, () => {
      const r = classifyStop(stop, h, [sig(h, 50, 0)]);
      expect(r.kind).toBe('queue');
      expect(r.distM).toBeGreaterThanOrEqual(49); expect(r.distM).toBeLessThanOrEqual(51);
    });
  }

  it('a signal right at the front of the car = at the light', () => {
    expect(classifyStop(stop, 0, [sig(0, 10, 2)]).kind).toBe('light');
  });

  it('a signal just BEHIND the stop line still counts as at the light (GPS places you past it)', () => {
    expect(classifyStop(stop, 0, [sig(0, -8, 0)]).kind).toBe('light');
  });

  it('a signal well BEHIND you does not explain the stop', () => {
    expect(classifyStop(stop, 0, [sig(0, -60, 0)]).kind).toBe('other');
  });

  it('a signal beyond queue distance does not explain it', () => {
    expect(classifyStop(stop, 0, [sig(0, 400, 0)]).kind).toBe('other');
  });

  it('a signal on a parallel/side street (far off the car\'s line) does not explain it', () => {
    expect(classifyStop(stop, 0, [sig(0, 50, 90)]).kind).toBe('other');
  });

  it('the same signal is ahead or behind depending on the direction of travel', () => {
    const f = [sig(0, 50, 0)];                       // 50 m north of the stop
    expect(classifyStop(stop, 0, f).kind).toBe('queue');          // heading north: it is ahead
    expect(classifyStop(stop, Math.PI, f).kind).toBe('other');    // heading south: it is behind
  });

  it('prefers the light you are at over a farther one ahead', () => {
    expect(classifyStop(stop, 0, [sig(0, 120, 0), sig(0, 5, 0)]).kind).toBe('light');
  });

  it('uses the NEAREST signal ahead for the queue distance', () => {
    expect(classifyStop(stop, 0, [sig(0, 150, 0), sig(0, 70, 0)]).distM).toBeCloseTo(70, -1);
  });

  it('recognises a stop sign, but a signal outranks it', () => {
    expect(classifyStop(stop, 0, [stp(0, 6, 0)]).kind).toBe('sign');
    expect(classifyStop(stop, 0, [stp(0, 6, 0), sig(0, 8, 0)]).kind).toBe('light');
  });

  it('a stop sign far down the road is not "at a stop sign"', () => {
    expect(classifyStop(stop, 0, [stp(0, 80, 0)]).kind).toBe('other');
  });

  it('with no features at all it is "other"', () => {
    expect(classifyStop(stop, 0, []).kind).toBe('other');
    expect(classifyStop(stop, 0, null).kind).toBe('other');
  });

  it('with no heading it falls back to plain proximity', () => {
    expect(classifyStop(stop, null, [sig(0, 10, 5)]).kind).toBe('light');
    expect(classifyStop(stop, null, [sig(0, 100, 0)]).kind).toBe('other');
  });
});

describe('bearing / headingBefore', () => {
  it('bearing: north ≈ 0, east ≈ π/2, south ≈ π', () => {
    expect(bearing(stop, at(0, 100))).toBeCloseTo(0, 2);
    expect(bearing(stop, at(Math.PI / 2, 100))).toBeCloseTo(Math.PI / 2, 2);
    expect(Math.abs(bearing(stop, at(Math.PI, 100)))).toBeCloseTo(Math.PI, 2);
  });

  it('takes the direction from the last real movement, ignoring GPS jitter while crawling', () => {
    // Driving east, then sitting still with a metre of jitter.
    const samples = [0, 1, 2, 3, 4, 5].map(i => ({ t: i * 1000, ...at(Math.PI / 2, (i - 5) * 12) }));
    samples.push({ t: 6000, ...at(Math.PI / 2, 0.4, 0.5) }, { t: 7000, ...at(Math.PI / 2, -0.3, -0.4) });
    const h = headingBefore(samples, 7);
    expect(h).toBeCloseTo(Math.PI / 2, 1);
  });

  it('returns null when the car never moved far enough to tell', () => {
    const samples = [0, 1, 2].map(i => ({ t: i * 1000, ...at(0, i * 0.5) }));
    expect(headingBefore(samples, 2)).toBeNull();
  });
});

describe('classifyStops — end to end on a drive', () => {
  it('labels each stop using the direction the car was actually travelling', () => {
    // Drive east toward a signal, stop 50 m short of it.
    const h = Math.PI / 2;
    const samples = [];
    for (let i = 0; i < 12; i++) samples.push({ t: i * 1000, speed: 10, ...at(h, (i - 12) * 10) });   // approaching
    const stopPos = at(h, -5);                                                                          // halted at -5 m
    samples.push({ t: 12000, speed: 0, ...stopPos });
    const features = [{ ...at(h, 45), kind: 'signal' }];   // 50 m ahead of where it halted
    const out = classifyStops([{ t: 12000, lat: stopPos.lat, lon: stopPos.lon, durationMs: 20000 }], samples, features);
    expect(out[0].kind).toBe('queue');
  });
});

describe('summaries', () => {
  it('counts causes and phrases only those that occurred', () => {
    const c = countCauses([{ kind: 'light' }, { kind: 'light' }, { kind: 'queue' }, { kind: 'other' }]);
    expect(c).toEqual({ light: 2, queue: 1, sign: 0, other: 1 });
    expect(describeCauses(c)).toBe('2 at a light · 1 in a queue for one · 1 with no signal nearby');
    expect(describeCauses({ light: 0, queue: 0, sign: 0, other: 0 })).toBe('');
  });

  it('popup wording includes the distance for a queue', () => {
    expect(describeCause({ kind: 'queue', distM: 50 })).toMatch(/50 m ahead/);
    expect(describeCause({ kind: 'light' })).toMatch(/traffic light/);
  });
});

describe('fetchStopFeatures — fails soft and caches', () => {
  const stops = [{ lat: 39.7, lon: -104.9 }];
  const okResponse = { ok: true, json: async () => ({ elements: [
    { type: 'node', id: 1, lat: 39.7005, lon: -104.9, tags: { highway: 'traffic_signals' } },
    { type: 'node', id: 1, lat: 39.7005, lon: -104.9, tags: { highway: 'traffic_signals' } },   // duplicate id
    { type: 'node', id: 2, lat: 39.701,  lon: -104.9, tags: { highway: 'stop' } },
    { type: 'node', id: 3, lat: 39.702,  lon: -104.9, tags: { highway: 'crossing' } },           // ignored
  ] }) };

  it('returns de-duplicated signals and stop signs', async () => {
    const f = await fetchStopFeatures('drive-a', stops, { fetchImpl: vi.fn().mockResolvedValue(okResponse) });
    expect(f).toHaveLength(2);
    expect(f.map(x => x.kind).sort()).toEqual(['signal', 'stop']);
  });

  it('serves the second request from cache without touching the network', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse);
    await fetchStopFeatures('drive-b', stops, { fetchImpl });
    await fetchStopFeatures('drive-b', stops, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('tries the next mirror when the first fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error('blocked')).mockResolvedValueOnce(okResponse);
    const f = await fetchStopFeatures('drive-c', stops, { fetchImpl });
    expect(f).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('returns null (no labels) when every mirror fails, and does not cache the failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await fetchStopFeatures('drive-d', stops, { fetchImpl })).toBeNull();
    const good = vi.fn().mockResolvedValue(okResponse);
    expect(await fetchStopFeatures('drive-d', stops, { fetchImpl: good })).toHaveLength(2);   // retried, not stuck on null
  });

  it('does nothing for a drive with no stops', async () => {
    const fetchImpl = vi.fn();
    expect(await fetchStopFeatures('drive-e', [], { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
