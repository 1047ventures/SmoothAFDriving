/**
 * Why did you stop? — match each full stop to the traffic signals / stop signs
 * on the map around it.
 *
 * The score counts full stops, but a stop has very different causes: sitting at
 * a red light, waiting in the queue 50 m back from one, a stop sign, or nothing
 * on the map at all (a jam, a turn, a pickup). From GPS alone those look the
 * same. OpenStreetMap tags signals (`highway=traffic_signals`) and stop signs
 * (`highway=stop`) as nodes, so with the stop's position and the direction the
 * car was travelling we can say which it was.
 *
 * The key rule — a feature only explains a stop if it is AHEAD of the car along
 * its direction of travel. A signal behind you, or on a street off to the side,
 * is not why you stopped; a signal 50 m ahead with a line of cars between is.
 *
 * `classifyStops` is pure (no I/O) so it's unit-tested; `fetchStopFeatures` is the
 * only part that touches the network, and it fails soft — no data means no
 * labels, never an error in the recap.
 */

const M_PER_DEG = 111111;

// You are "at" the light when its node is within this far ahead of you…
export const AT_LIGHT_AHEAD_M  = 30;
// …or this far behind (the stop line is a few metres past where GPS places you).
export const AT_LIGHT_BEHIND_M = 12;
// Beyond the line, a signal this far ahead still explains the stop: you're in its queue.
export const QUEUE_MAX_M       = 200;
// How far off the car's line a feature may sit and still be on YOUR road.
export const LATERAL_MAX_M     = 25;

/** Compass-style bearing from a→b in radians (0 = north, π/2 = east). */
export function bearing(a, b){
  const dy = (b.lat - a.lat);
  const dx = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.atan2(dx, dy);
}

function metersBetween(a, b){
  const dy = (b.lat - a.lat) * M_PER_DEG;
  const dx = (b.lon - a.lon) * M_PER_DEG * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot(dx, dy);
}

/**
 * Direction of travel just before sample `idx` — from the nearest earlier sample
 * that is at least `minDist` metres away (so GPS jitter while crawling doesn't
 * spin the heading). Null when the car never moved enough to tell.
 */
export function headingBefore(samples, idx, minDist = 15, lookback = 25){
  const here = samples[idx];
  if (!here) return null;
  for (let j = idx - 1; j >= Math.max(0, idx - lookback); j--){
    if (metersBetween(samples[j], here) >= minDist) return bearing(samples[j], here);
  }
  return null;
}

/**
 * Classify one stop against nearby map features.
 *   stop:     { lat, lon }
 *   heading:  radians (0 = north) or null
 *   features: [{ lat, lon, kind: 'signal' | 'stop' }]
 * Returns { kind: 'light' | 'queue' | 'sign' | 'other', distM }.
 */
export function classifyStop(stop, heading, features){
  const feats = features || [];
  // No usable heading (never got moving): fall back to plain proximity.
  if (heading == null){
    let best = null;
    for (const f of feats){
      const d = metersBetween(stop, f);
      if (d <= AT_LIGHT_AHEAD_M && (!best || d < best.d)) best = { d, f };
    }
    if (!best) return { kind: 'other', distM: null };
    return { kind: best.f.kind === 'signal' ? 'light' : 'sign', distM: Math.round(best.d) };
  }

  const sinH = Math.sin(heading), cosH = Math.cos(heading);
  let light = null, queue = null, sign = null;
  for (const f of feats){
    const dy = (f.lat - stop.lat) * M_PER_DEG;
    const dx = (f.lon - stop.lon) * M_PER_DEG * Math.cos(stop.lat * Math.PI / 180);
    const forward = dx * sinH + dy * cosH;           // + ahead of the car
    const lateral = Math.abs(dx * cosH - dy * sinH); // distance off the car's line
    if (lateral > LATERAL_MAX_M) continue;
    if (f.kind === 'signal'){
      if (forward >= -AT_LIGHT_BEHIND_M && forward <= AT_LIGHT_AHEAD_M){
        if (!light || Math.abs(forward) < Math.abs(light.forward)) light = { forward };
      } else if (forward > AT_LIGHT_AHEAD_M && forward <= QUEUE_MAX_M){
        if (!queue || forward < queue.forward) queue = { forward };       // nearest one ahead
      }
    } else if (f.kind === 'stop'){
      if (forward >= -AT_LIGHT_BEHIND_M && forward <= AT_LIGHT_AHEAD_M){
        if (!sign || Math.abs(forward) < Math.abs(sign.forward)) sign = { forward };
      }
    }
  }
  if (light) return { kind: 'light', distM: Math.round(Math.max(0, light.forward)) };
  if (queue) return { kind: 'queue', distM: Math.round(queue.forward) };
  if (sign)  return { kind: 'sign',  distM: Math.round(Math.max(0, sign.forward)) };
  return { kind: 'other', distM: null };
}

/**
 * Classify every counted stop of a drive. `markers` are analyzeDrive's
 * stopMarkers (their `t` is the first stationary sample's time); `samples` give
 * the position and the direction of travel just before each stop.
 */
export function classifyStops(markers, samples, features){
  return (markers || []).map((m) => {
    const idx = (samples || []).findIndex(s => s.t === m.t);
    const at  = idx >= 0 ? samples[idx] : { lat: m.lat, lon: m.lon };
    const heading = idx >= 0 ? headingBefore(samples, idx) : null;
    return classifyStop({ lat: at.lat, lon: at.lon }, heading, features);
  });
}

/** { light, queue, sign, other } counts for a classification list. */
export function countCauses(classified){
  const c = { light: 0, queue: 0, sign: 0, other: 0 };
  for (const k of classified || []) c[k.kind] = (c[k.kind] || 0) + 1;
  return c;
}

/** One line for the recap, only mentioning causes that occurred. */
export function describeCauses(counts){
  const parts = [];
  if (counts.light) parts.push(`${counts.light} at a light`);
  if (counts.queue) parts.push(`${counts.queue} in a queue for one`);
  if (counts.sign)  parts.push(`${counts.sign} at a stop sign`);
  if (counts.other) parts.push(`${counts.other} with no signal nearby`);
  return parts.join(' · ');
}

/** Popup wording for a single stop. */
export function describeCause(k){
  switch (k && k.kind){
    case 'light': return 'At a traffic light';
    case 'queue': return `Waiting in a queue — a light ${k.distM} m ahead`;
    case 'sign':  return 'At a stop sign';
    default:      return 'No signal or sign nearby — traffic, a turn, or a pickup';
  }
}

// ── Map lookup (the only part that touches the network) ─────────────────────

const CACHE_KEY = 'smoothaf.stop_features';
const CACHE_MAX = 25;
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const FETCH_RADIUS_M = QUEUE_MAX_M + 40;
const MAX_STOPS_QUERIED = 40;

function readCache(){
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; }
}
function writeCache(obj){
  try {
    const keys = Object.keys(obj).sort((a, b) => (obj[b].at || 0) - (obj[a].at || 0)).slice(0, CACHE_MAX);
    const pruned = {};
    for (const k of keys) pruned[k] = obj[k];
    localStorage.setItem(CACHE_KEY, JSON.stringify(pruned));
  } catch { /* storage full — the next view just refetches */ }
}

/**
 * Signals and stop signs around the given stop positions. Cached per drive so
 * reopening a recap is instant and offline-safe. Resolves to null on any failure
 * (offline, rate-limited, blocked) — callers then simply show no cause labels.
 */
export async function fetchStopFeatures(cacheId, stops, { fetchImpl = fetch } = {}){
  const id = String(cacheId);
  const cache = readCache();
  if (cache[id] && Array.isArray(cache[id].features)) return cache[id].features;

  const pts = (stops || []).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon)).slice(0, MAX_STOPS_QUERIED);
  if (!pts.length) return [];
  const around = pts.map(s =>
    `node["highway"="traffic_signals"](around:${FETCH_RADIUS_M},${s.lat.toFixed(5)},${s.lon.toFixed(5)});` +
    `node["highway"="stop"](around:${FETCH_RADIUS_M},${s.lat.toFixed(5)},${s.lon.toFixed(5)});`
  ).join('');
  const body = 'data=' + encodeURIComponent(`[out:json][timeout:20];(${around});out;`);

  for (const url of ENDPOINTS){
    try {
      const res = await fetchImpl(url, {
        method: 'POST', body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(15000) : undefined,
      });
      if (!res.ok) continue;
      const json = await res.json();
      const seen = new Set(), features = [];
      for (const e of json.elements || []){
        if (e.type !== 'node' || seen.has(e.id)) continue;
        seen.add(e.id);
        const hw = e.tags && e.tags.highway;
        if (hw === 'traffic_signals') features.push({ lat: e.lat, lon: e.lon, kind: 'signal' });
        else if (hw === 'stop')       features.push({ lat: e.lat, lon: e.lon, kind: 'stop' });
      }
      cache[id] = { at: Date.now(), features };
      writeCache(cache);
      return features;
    } catch { /* try the next mirror */ }
  }
  return null;
}
