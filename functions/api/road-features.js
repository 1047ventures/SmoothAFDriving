// Cloudflare Pages Function — /api/road-features
//
// Traffic lights and stop signs for a few map tiles, from our own table
// (road_features). The app uses them to tell a red light from a stop you chose,
// and asks only us, so a public map server being down or blocking us can't take
// that away. A tile we don't hold yet is fetched from OpenStreetMap's Overpass
// servers here, saved, and never fetched again for a year.
//
// POST { tiles: ["794_-2091", ...] }  →  { features: [{ lat, lon, kind }], unavailable: [tiles] }
// Tiles only (about 5 km squares, src/shared/roadTiles.mjs): never a driver's exact spot.
import { corsHeaders } from '../../src/shared/cors.mjs';
import { isTile, tileBbox } from '../../src/shared/roadTiles.mjs';

const MAX_TILES = 30;          // a long drive's stops span a handful; this is abuse protection
const MAX_UPSTREAM = 6;        // new tiles fetched per request, so one call can't hammer Overpass
const FRESH_MS = 365 * 24 * 3600 * 1000;
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const UA = 'SmoothAFDriving/1.0 (+https://smoothafdriving.pages.dev/support)';

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function onRequestPost(context, fetchImpl = fetch) {
  const { request, env } = context;
  const cors = corsHeaders(request);
  const json = (status, obj) =>
    new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });
  const SB_URL = env.SUPABASE_URL;
  const KEY = env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !KEY) return json(500, { error: 'misconfigured' });

  const body = await request.json().catch(() => ({}));
  const tiles = [...new Set(Array.isArray(body.tiles) ? body.tiles : [])].filter(isTile).slice(0, MAX_TILES);
  if (!tiles.length) return json(200, { features: [], unavailable: [] });

  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
  const sb = (path, init = {}) => fetchImpl(`${SB_URL}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const inList = list => `in.(${list.map(t => `"${t}"`).join(',')})`;

  try {
    const held = await (await sb(`/rest/v1/road_tiles?tile=${inList(tiles)}&select=tile,fetched_at`)).json();
    const fresh = new Set((Array.isArray(held) ? held : [])
      .filter(r => Date.now() - Date.parse(r.fetched_at) < FRESH_MS).map(r => r.tile));
    const missing = tiles.filter(t => !fresh.has(t));

    const unavailable = [];
    for (const [i, tile] of missing.entries()) {
      const got = i < MAX_UPSTREAM ? await fetchTile(tile, fetchImpl) : null;
      if (!got) { unavailable.push(tile); continue; }
      if (got.length) {
        await sb('/rest/v1/road_features?on_conflict=osm_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(got.map(f => ({ ...f, tile }))),
        });
      }
      await sb('/rest/v1/road_tiles?on_conflict=tile', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ tile, fetched_at: new Date().toISOString(), source: 'overpass' }),
      });
    }

    const have = tiles.filter(t => !unavailable.includes(t));
    const rows = have.length
      ? await (await sb(`/rest/v1/road_features?tile=${inList(have)}&select=lat,lon,kind`)).json()
      : [];
    return json(200, { features: Array.isArray(rows) ? rows : [], unavailable });
  } catch {
    return json(502, { error: 'lookup_failed' });
  }
}

/** One tile's lights and stop signs from Overpass, trying each mirror; null if none answered. */
export async function fetchTile(tile, fetchImpl = fetch) {
  const [s, w, n, e] = tileBbox(tile);
  const q = `[out:json][timeout:25];(node["highway"="traffic_signals"](${s},${w},${n},${e});node["highway"="stop"](${s},${w},${n},${e}););out;`;
  for (const url of OVERPASS) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) continue;
      const j = await res.json();
      return (j.elements || [])
        .filter(el => el.type === 'node' && el.tags)
        .map(el => ({ osm_id: el.id, lat: el.lat, lon: el.lon, kind: el.tags.highway === 'stop' ? 'stop' : 'signal' }));
    } catch { /* next mirror */ }
  }
  return null;
}
