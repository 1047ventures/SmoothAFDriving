/**
 * Where did it happen? — turn a harsh event's coordinates into a street name.
 *
 * "9 minutes 36 seconds in" means nothing once the drive is over; "Sharp turn onto
 * Federal Boulevard" is a place you can picture. OpenStreetMap has the named roads,
 * so given an event's position and the track around it we say:
 *   · a turn   → "onto <the road you ended up on>" (or "on" if the name didn't change)
 *   · a brake / accel → "on <the road you were driving>"
 *
 * `placeFor` is pure (event + samples + ways in, words out) so it's unit-tested;
 * `resolveEventStreets` is the only part that touches the network, and it fails soft —
 * no data means the recap keeps its old wording, never an error.
 */
const M_PER_DEG = 111111;
export const STREET_MAX_M = 30;       // an event further than this from any named road isn't "on" it
const BEHIND_M = 25, AHEAD_M = 30;    // where along the track we read the road before / after a turn

const cosLat = (lat) => Math.cos(lat * Math.PI / 180);
const metersBetween = (a, b) =>
  Math.hypot((b.lat - a.lat) * M_PER_DEG, (b.lon - a.lon) * M_PER_DEG * cosLat((a.lat + b.lat) / 2));

/** Distance in metres from point p to the segment a–b (local flat-earth projection). */
export function distToSegment(p, a, b){
  const k = cosLat(p.lat);
  const px = 0, py = 0;
  const ax = (a.lon - p.lon) * M_PER_DEG * k, ay = (a.lat - p.lat) * M_PER_DEG;
  const bx = (b.lon - p.lon) * M_PER_DEG * k, by = (b.lat - p.lat) * M_PER_DEG;
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx - px, ay + t * dy - py);
}

const labelOf = (w) => (w.name || w.ref || '').trim();

/** Nearest named road to a point, or null if none is within maxM. ways: [{name, ref, pts:[{lat,lon}]}] */
export function nearestStreet(p, ways, maxM = STREET_MAX_M){
  let best = null;
  for (const w of ways || []){
    const label = labelOf(w);
    if (!label || !w.pts || w.pts.length < 2) continue;
    let d = Infinity;
    for (let i = 1; i < w.pts.length; i++) d = Math.min(d, distToSegment(p, w.pts[i - 1], w.pts[i]));
    if (d <= maxM && (!best || d < best.d)) best = { name: label, d };
  }
  return best ? best.name : null;
}

/** Position on the track `metres` before (dir -1) or after (dir +1) the sample nearest time t. */
function trackPoint(samples, t, metres, dir){
  const pts = (samples || []).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon));
  if (!pts.length || t == null) return null;
  let i = pts.findIndex(s => s.t >= t);
  if (i < 0) i = pts.length - 1;
  const here = pts[i];
  for (let j = i + dir; j >= 0 && j < pts.length; j += dir){
    if (metersBetween(here, pts[j]) >= metres) return pts[j];
  }
  return null;     // the track ends (or the car barely moved) before reaching that far
}

/**
 * Words for where an event happened, given the roads around it.
 * Returns { street, kind: 'onto' | 'on' } or null when no named road is close enough.
 */
export function placeFor(event, samples, ways){
  if (event?.lat == null || event?.lon == null) return null;
  const P = { lat: event.lat, lon: event.lon };
  const behind = trackPoint(samples, event.t, BEHIND_M, -1);
  const ahead  = trackPoint(samples, event.t, AHEAD_M, +1);
  const before = (behind && nearestStreet(behind, ways)) || nearestStreet(P, ways);

  if (event.type === 'turn'){
    const after = ahead && nearestStreet(ahead, ways);
    if (after && before && after !== before) return { street: after, kind: 'onto' };
    const on = after || before;
    return on ? { street: on, kind: 'on' } : null;
  }
  return before ? { street: before, kind: 'on' } : null;
}

/** Stable key for an event inside one drive. */
export const eventKey = (e) => `${e.type}@${Math.round(e.t || 0)}`;

// ── Map lookup (the only part that touches the network) ─────────────────────

const CACHE_KEY = 'smoothaf.event_streets';
const CACHE_MAX = 40;
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const ROADS = '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street)(_link)?$';
const QUERY_RADIUS_M = STREET_MAX_M + 15;

const readCache = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; } };
function writeCache(obj){
  try {
    const keys = Object.keys(obj).sort((a, b) => (obj[b].at || 0) - (obj[a].at || 0)).slice(0, CACHE_MAX);
    const pruned = {}; for (const k of keys) pruned[k] = obj[k];
    localStorage.setItem(CACHE_KEY, JSON.stringify(pruned));
  } catch { /* storage full — the next view just refetches */ }
}

/**
 * Street wording for a handful of events: { [eventKey]: { street, kind } }. Cached per
 * drive (the small result, not the road geometry). Resolves to null on any failure.
 */
export async function resolveEventStreets(cacheId, samples, events, { fetchImpl = fetch } = {}){
  const id = String(cacheId);
  const cache = readCache();
  if (cache[id] && cache[id].places) return cache[id].places;

  const evs = (events || []).filter(e => e.lat != null && e.lon != null).slice(0, 4);
  if (!evs.length) return {};
  // Query around the event and around the track points we read the road from.
  const pts = [];
  for (const e of evs){
    pts.push({ lat: e.lat, lon: e.lon });
    for (const [m, dir] of [[BEHIND_M, -1], [AHEAD_M, 1]]){
      const p = trackPoint(samples, e.t, m, dir); if (p) pts.push({ lat: p.lat, lon: p.lon });
    }
  }
  const around = pts.map(p =>
    `way["highway"~"${ROADS}"][~"^(name|ref)$"~"."](around:${QUERY_RADIUS_M},${p.lat.toFixed(5)},${p.lon.toFixed(5)});`).join('');
  const body = 'data=' + encodeURIComponent(`[out:json][timeout:20];(${around});out tags geom;`);

  for (const url of ENDPOINTS){
    try {
      const res = await fetchImpl(url, {
        method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(15000) : undefined,
      });
      if (!res.ok) continue;
      const json = await res.json();
      const seen = new Set(), ways = [];
      for (const w of json.elements || []){
        if (w.type !== 'way' || seen.has(w.id) || !Array.isArray(w.geometry)) continue;
        seen.add(w.id);
        ways.push({ name: w.tags?.name, ref: w.tags?.ref, pts: w.geometry.map(g => ({ lat: g.lat, lon: g.lon })) });
      }
      const places = {};
      for (const e of evs){ const p = placeFor(e, samples, ways); if (p) places[eventKey(e)] = p; }
      cache[id] = { at: Date.now(), places };
      writeCache(cache);
      return places;
    } catch { /* try the next mirror */ }
  }
  return null;
}
