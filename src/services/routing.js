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
} from '../constants.js';

function useMapbox(){ return ROUTING_PROVIDER === 'mapbox' && !!MAPBOX_TOKEN; }

// True when live-traffic ETAs are active — callers can drop the OSRM optimism
// buffer (ETA_BUFFER) toward 1.0 since Mapbox durations already reflect traffic.
export function isTrafficAware(){ return useMapbox(); }

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
