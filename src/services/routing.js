// Provider-agnostic routing. The rest of the app calls only geocode()/fetchRoute();
// swapping to Google/Mapbox (traffic-aware) touches only this file.
//
// MVP backends are the free public Nominatim + OSRM demo servers. These are
// best-effort and rate-limited (Nominatim: <=1 req/sec, no keystroke autocomplete)
// — fine for prototyping/personal use, NOT production scale. Before launch, move
// to a paid or self-hosted provider. Browsers cannot set a User-Agent header, so
// we rely on the default UA/Referer (accepted by Nominatim at low volume).
import { NOMINATIM_BASE, OSRM_BASE } from '../constants.js';

// query -> [{ label, lat, lng }] (up to 5) | null
export async function geocode(query){
  if (!query || !query.trim()) return null;
  try {
    const url = `${NOMINATIM_BASE}/search?format=jsonv2&limit=5&q=${encodeURIComponent(query.trim())}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return data.map(r => ({ label: r.display_name, lat: +r.lat, lng: +r.lon }));
  } catch {
    return null;
  }
}

// lat,lng -> { label, lat, lng } | null. Turns a map-picked point into a
// human-readable place name (for the "find on map" destination flow).
export async function reverseGeocode(lat, lng){
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

// from/to are { lat, lng } -> { distanceM, durationSec, geometry:[[lat,lng]] } | null
export async function fetchRoute(from, to){
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
