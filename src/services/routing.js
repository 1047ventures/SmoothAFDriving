// Provider-agnostic routing. The rest of the app calls only
// geocode() / reverseGeocode() / fetchRoute(); switching providers is config-only.
//
// Two backends:
//  - 'osm'    : free Nominatim + OSRM demo servers. No live traffic; rate-limited.
//               Fine for prototyping/personal use, NOT production scale.
//  - 'mapbox' : Mapbox Search (geocode) + Directions `driving-traffic` — ETAs are
//               traffic-aware. Needs a token (public token, set at build time as
//               VITE_MAPBOX_TOKEN; safe in the client, URL-restrict it in Mapbox).
//
// We use Mapbox when ROUTING_PROVIDER==='mapbox' AND a token is present; otherwise
// we fall back to OSM. So the app keeps working before the key is configured and
// goes traffic-aware automatically the moment the token is set at build.
//
// Every call is try/caught → value-or-null: routing never throws to callers and a
// failure just means "no ETA target", never a blocked drive.
import {
  ROUTING_PROVIDER, MAPBOX_TOKEN, MAPBOX_BASE, NOMINATIM_BASE, OSRM_BASE,
  ETA_BUFFER, ETA_BUFFER_TRAFFIC,
} from '../constants.js';

function useMapbox(){ return ROUTING_PROVIDER === 'mapbox' && !!MAPBOX_TOKEN; }

// True when live-traffic ETAs are active — the ETA already reflects lights and
// congestion, so it barely needs padding.
export function isTrafficAware(){ return useMapbox(); }

// The buffer to apply to a raw route ETA, for the CURRENTLY active provider.
// This is the one place the choice is made; scoring takes the value as input so
// it never has to know which map engine produced the number.
export function etaBuffer(){ return isTrafficAware() ? ETA_BUFFER_TRAFFIC : ETA_BUFFER; }

// query -> [{ label, lat, lng }] (up to 5) | null
export async function geocode(query){
  if (!query || !query.trim()) return null;
  return useMapbox() ? mapboxGeocode(query.trim()) : osmGeocode(query.trim());
}

// lat,lng -> { label, lat, lng } | null
export async function reverseGeocode(lat, lng){
  return useMapbox() ? mapboxReverse(lat, lng) : osmReverse(lat, lng);
}

// from/to are { lat, lng } -> { distanceM, durationSec, geometry:[[lat,lng]] } | null
export async function fetchRoute(from, to){
  return useMapbox() ? mapboxRoute(from, to) : osmRoute(from, to);
}

// ── Traffic ───────────────────────────────────────────────────────────────────
// The yardstick is the same trip at 3am — Mapbox's typical traffic on empty
// roads. (Its plain `driving` profile is NOT empty roads: it's about midday
// traffic, so it hid most of rush hour.) ratio = trip time ÷ 3am trip time.

// Mapbox `depart_at` takes the origin's local wall-clock time, no offset.
function localStamp(d){
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// The next 3am after `now`.
export function nextQuietTime(now = new Date()){
  const d = new Date(now);
  d.setHours(3, 0, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return d;
}

// The next time it's the same weekday and clock time as `when`, at least a day
// out — near-term departures blend in today's live traffic, and we want the usual.
export function nextSameSlot(when, now = new Date()){
  const w = new Date(when), d = new Date(now);
  d.setHours(w.getHours(), w.getMinutes(), 0, 0);
  d.setDate(d.getDate() + ((w.getDay() - d.getDay() + 7) % 7));
  if (d.getTime() < now.getTime() + 24 * 3600e3) d.setDate(d.getDate() + 7);
  return d;
}

async function mapboxTrafficSec(from, to, departAt = null){
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const at = departAt ? `&depart_at=${localStamp(departAt)}` : '';
  const res = await fetch(`${MAPBOX_BASE}/directions/v5/mapbox/driving-traffic/${coords}?overview=false${at}&access_token=${MAPBOX_TOKEN}`);
  if (!res.ok) return null;
  return (await res.json())?.routes?.[0]?.duration ?? null;
}

function ratioOf(trafficSec, freeSec){
  if (!(trafficSec > 0) || !(freeSec > 0)) return null;
  // base marks the 3am yardstick; readings without it used the old midday one.
  return { ratio: +(trafficSec / freeSec).toFixed(2), trafficSec: Math.round(trafficSec), freeSec: Math.round(freeSec), base: '3am' };
}

// Traffic on the trip right now (read right after a drive). Mapbox only → else null.
// from/to are { lat, lng } -> { ratio, trafficSec, freeSec } | null
export async function fetchTrafficRatio(from, to){
  if (!useMapbox()) return null;
  try {
    const [live, quiet] = await Promise.all([mapboxTrafficSec(from, to), mapboxTrafficSec(from, to, nextQuietTime())]);
    return ratioOf(live, quiet);
  } catch {
    return null;
  }
}

// Typical traffic for a past drive: the same trip at the same weekday and time
// next week (Mapbox predicts typical traffic for future departures). An estimate
// of what the road is usually like then, not what was there that day.
export async function fetchTypicalTrafficRatio(from, to, whenMs){
  if (!useMapbox()) return null;
  try {
    const [slot, quiet] = await Promise.all([mapboxTrafficSec(from, to, nextSameSlot(whenMs)), mapboxTrafficSec(from, to, nextQuietTime())]);
    return ratioOf(slot, quiet);
  } catch {
    return null;
  }
}

// ── OSM: Nominatim + OSRM ─────────────────────────────────────────────────────
async function osmGeocode(q){
  try {
    const url = `${NOMINATIM_BASE}/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return data.map(r => ({ label: r.display_name, lat: +r.lat, lng: +r.lon }));
  } catch {
    return null;
  }
}

async function osmReverse(lat, lng){
  try {
    const url = `${NOMINATIM_BASE}/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.display_name) return null;
    return { label: data.display_name, lat: +data.lat, lng: +data.lon };
  } catch {
    return null;
  }
}

async function osmRoute(from, to){
  try {
    const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const url = `${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const route = data && data.routes && data.routes[0];
    if (!route) return null;
    return {
      distanceM: route.distance,
      durationSec: route.duration,
      geometry: (route.geometry?.coordinates || []).map(([lng, lat]) => [lat, lng]),
    };
  } catch {
    return null;
  }
}

// ── Mapbox: Search (geocode v6) + Directions (driving-traffic) ────────────────
async function mapboxGeocode(q){
  try {
    const url = `${MAPBOX_BASE}/search/geocode/v6/forward?q=${encodeURIComponent(q)}&limit=5&access_token=${MAPBOX_TOKEN}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const feats = (await res.json())?.features;
    if (!Array.isArray(feats) || feats.length === 0) return null;
    return feats
      .map(f => ({
        label: f.properties?.full_address || f.properties?.name || 'Unknown place',
        lat: f.geometry?.coordinates?.[1],
        lng: f.geometry?.coordinates?.[0],
      }))
      .filter(r => r.lat != null && r.lng != null);
  } catch {
    return null;
  }
}

async function mapboxReverse(lat, lng){
  try {
    const url = `${MAPBOX_BASE}/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}&access_token=${MAPBOX_TOKEN}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const f = (await res.json())?.features?.[0];
    if (!f) return null;
    return {
      label: f.properties?.full_address || f.properties?.name || `Pinned (${lat}, ${lng})`,
      lat,
      lng,
    };
  } catch {
    return null;
  }
}

async function mapboxRoute(from, to){
  try {
    const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const url = `${MAPBOX_BASE}/directions/v5/mapbox/driving-traffic/${coords}?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const route = (await res.json())?.routes?.[0];
    if (!route) return null;
    return {
      distanceM: route.distance,
      durationSec: route.duration, // traffic-aware
      geometry: (route.geometry?.coordinates || []).map(([lng, lat]) => [lat, lng]),
    };
  } catch {
    return null;
  }
}
