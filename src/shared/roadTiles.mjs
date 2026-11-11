// Map tiles for our own copy of traffic lights and stop signs (the road_features
// table). Shared by the app (services/signals.js), the server (functions/api/
// road-features.js) and the bulk loader (scripts/load-road-features.mjs), so all
// three cut the world the same way.
//
// A tile is a 0.05° square, about 5.5 km north-south and 4.3 km east-west in
// Denver. The app only ever names tiles, never a stop's exact spot.

export const TILE_DEG = 0.05;
const M_PER_DEG_LAT = 111_320;

// Nudged so a value right on a tile edge (39.6 / 0.05 = 791.999…) lands where it reads.
const cell = v => Math.floor(v / TILE_DEG + 1e-9);

export function tileOf(lat, lon){
  return `${cell(lat)}_${cell(lon)}`;
}

export const isTile = t => typeof t === 'string' && /^-?\d{1,4}_-?\d{1,4}$/.test(t);

/** [south, west, north, east] of a tile. */
export function tileBbox(tile){
  const [y, x] = tile.split('_').map(Number);
  const r = v => +v.toFixed(6);
  return [r(y * TILE_DEG), r(x * TILE_DEG), r((y + 1) * TILE_DEG), r((x + 1) * TILE_DEG)];
}

/** Every tile within radiusM of a point (the stop's own tile, plus neighbours it nearly touches). */
export function tilesAround(lat, lon, radiusM){
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLon = radiusM / (M_PER_DEG_LAT * Math.max(0.1, Math.cos(lat * Math.PI / 180)));
  const out = new Set();
  for (const a of [lat - dLat, lat + dLat]) for (const b of [lon - dLon, lon + dLon]) out.add(tileOf(a, b));
  out.add(tileOf(lat, lon));
  return [...out];
}

/** Every tile covering a bounding box, for loading a whole region. */
export function tilesInBbox(south, west, north, east){
  const out = [];
  for (let y = cell(south); y < Math.ceil(north / TILE_DEG - 1e-9); y++)
    for (let x = cell(west); x < Math.ceil(east / TILE_DEG - 1e-9); x++) out.push(`${y}_${x}`);
  return out;
}
