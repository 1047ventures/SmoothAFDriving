import { MAPBOX_TOKEN } from '../constants.js';

/**
 * The base dark tiles for every Leaflet map in the app (recap + destination).
 *
 * CARTO's free basemap CDN started stamping "API KEY REQUIRED" across keyless
 * tiles, which is what plastered the recap map. We already hold a Mapbox token,
 * so serve Mapbox's dark style with it and fall back to CARTO only when no token
 * was baked into the build — a watermarked map still beats a blank grid.
 *
 * `L` is the Leaflet global loaded from the CDN <script>, same as everywhere the
 * maps are built; this is only ever called at render time, after it exists.
 */
export function baseTiles(){
  if (MAPBOX_TOKEN){
    return L.tileLayer(
      `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/512/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
      { maxZoom: 20, tileSize: 512, zoomOffset: -1, attribution: '&copy; Mapbox &copy; OpenStreetMap' },
    );
  }
  return L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 20, attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd',
  });
}
