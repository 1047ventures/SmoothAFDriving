import { describe, it, expect, vi } from 'vitest';
import { tileOf, tileBbox, tilesAround, tilesInBbox, isTile } from '../shared/roadTiles.mjs';
import { onRequestPost } from '../../functions/api/road-features.js';

describe('map tiles', () => {
  it('a point sits inside its own tile', () => {
    const t = tileOf(39.7402, -104.9530);
    const [s, w, n, e] = tileBbox(t);
    expect(39.7402).toBeGreaterThanOrEqual(s); expect(39.7402).toBeLessThan(n);
    expect(-104.9530).toBeGreaterThanOrEqual(w); expect(-104.9530).toBeLessThan(e);
    expect(isTile(t)).toBe(true);
  });
  it('a stop near a tile edge also asks for the neighbour', () => {
    expect(tilesAround(39.7499, -104.9, 240).length).toBeGreaterThan(1);
    expect(tilesAround(39.725, -104.925, 240)).toEqual([tileOf(39.725, -104.925)]);
  });
  it('covers a region exactly', () => {
    const tiles = tilesInBbox(39.6, -105.0, 39.8, -104.8);
    expect(tiles.length).toBe(4 * 4);
    expect(tiles).toContain(tileOf(39.6, -105.0));
    expect(tiles).toContain(tileOf(39.79, -104.81));
    expect(tiles).not.toContain(tileOf(39.8, -104.8));
  });
  it('rejects anything that is not a tile', () => {
    expect(isTile('1_2')).toBe(true);
    expect(isTile("1_2);drop table")).toBe(false);
    expect(isTile(42)).toBe(false);
  });
});

describe('/api/road-features', () => {
  const env = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_KEY: 'k' };
  const req = (body) => new Request('https://x/api/road-features', { method: 'POST', body: JSON.stringify(body), headers: { Origin: 'capacitor://localhost' } });
  const res = (body, ok = true) => ({ ok, json: async () => body });

  it('answers held tiles from our table without calling Overpass', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('/road_tiles?')) return res([{ tile: '794_-2091', fetched_at: new Date().toISOString() }]);
      if (url.includes('/road_features?tile=')) return res([{ lat: 39.7, lon: -104.5, kind: 'signal' }]);
      throw new Error('unexpected ' + url);
    });
    const r = await onRequestPost({ request: req({ tiles: ['794_-2091'] }), env }, fetchImpl);
    expect(await r.json()).toEqual({ features: [{ lat: 39.7, lon: -104.5, kind: 'signal' }], unavailable: [] });
    expect(fetchImpl.mock.calls.some(([u]) => u.includes('overpass'))).toBe(false);
  });

  it('fetches a new tile once, saves it, then answers from the table', async () => {
    const saved = [];
    const fetchImpl = vi.fn(async (url, init = {}) => {
      if (url.includes('/road_tiles?tile=')) return res([]);
      if (url.includes('overpass')) return res({ elements: [{ type: 'node', id: 9, lat: 39.71, lon: -104.51, tags: { highway: 'stop' } }] });
      if (init.method === 'POST'){ saved.push([url, JSON.parse(init.body)]); return res(null); }
      if (url.includes('/road_features?tile=')) return res([{ lat: 39.71, lon: -104.51, kind: 'stop' }]);
      throw new Error('unexpected ' + url);
    });
    const r = await onRequestPost({ request: req({ tiles: ['794_-2091'] }), env }, fetchImpl);
    expect((await r.json()).features).toHaveLength(1);
    expect(saved[0][1][0]).toMatchObject({ osm_id: 9, kind: 'stop', tile: '794_-2091' });
    expect(saved[1][1]).toMatchObject({ tile: '794_-2091', source: 'overpass' });
  });

  it('says which tiles it could not fill when every map server fails', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('/road_tiles?tile=')) return res([]);
      if (url.includes('overpass')) return res(null, false);
      return res([]);
    });
    const r = await onRequestPost({ request: req({ tiles: ['794_-2091'] }), env }, fetchImpl);
    expect((await r.json()).unavailable).toEqual(['794_-2091']);
  });

  it('ignores junk and caps the request', async () => {
    const fetchImpl = vi.fn(async () => res([]));
    const r = await onRequestPost({ request: req({ tiles: ['nope', "1_1');--"] }), env }, fetchImpl);
    expect(await r.json()).toEqual({ features: [], unavailable: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
