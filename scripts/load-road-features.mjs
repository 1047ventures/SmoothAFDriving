#!/usr/bin/env node
// Bulk-load traffic lights and stop signs for a region into road_features, from an
// OpenStreetMap extract (Geofabrik), so lookups there never need a public map
// server. Run by .github/workflows/road-features.yml; it does the download and
// the osmium filtering, this does the database part.
//
//   node scripts/load-road-features.mjs <features.geojsonseq> <south,west,north,east> [--dry-run]
//
// Every tile fully inside the box is marked as held, empty ones too, so the app's
// server doesn't go looking for lights that aren't there. Tiles on the box's edge
// are left for the on-demand path, since a neighbouring region's lights would be missing.
// Needs SUPABASE_ACCESS_TOKEN (the same one the Supabase Setup workflow uses).
import fs from 'node:fs';
import { tileOf, tilesInBbox } from '../src/shared/roadTiles.mjs';

const [file, box, flag] = process.argv.slice(2);
const dryRun = flag === '--dry-run';
const [south, west, north, east] = (box || '').split(',').map(Number);
if (!file || [south, west, north, east].some(v => !Number.isFinite(v))) {
  console.error('usage: load-road-features.mjs <features.geojsonseq> <south,west,north,east> [--dry-run]');
  process.exit(1);
}
const REF = process.env.SUPABASE_PROJECT_REF || 'dbreetxubxdxogmektxc';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!dryRun && !TOKEN) { console.error('SUPABASE_ACCESS_TOKEN is not set'); process.exit(1); }

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`SQL ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

// osmium export → one GeoJSON point per line (RS-prefixed), with "@id" when run with -a id.
const rows = [];
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  const t = line.replace(/^\x1e/, '').trim();
  if (!t) continue;
  const f = JSON.parse(t);
  const [lon, lat] = f.geometry?.coordinates || [];
  const id = Number(String(f.properties?.['@id'] ?? f.id ?? '').replace(/^n/, ''));
  const hw = f.properties?.highway;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !id || !(hw === 'traffic_signals' || hw === 'stop')) continue;
  if (lat < south || lat > north || lon < west || lon > east) continue;
  rows.push({ id, kind: hw === 'stop' ? 'stop' : 'signal', lat, lon, tile: tileOf(lat, lon) });
}

// Tiles fully inside the box.
const inner = tilesInBbox(south, west, north, east).filter(t => {
  const [y, x] = t.split('_').map(Number);
  return y * 0.05 >= south && (y + 1) * 0.05 <= north && x * 0.05 >= west && (x + 1) * 0.05 <= east;
});
const counts = rows.reduce((m, r) => (m[r.kind] = (m[r.kind] || 0) + 1, m), {});
console.log(`${rows.length} features (${JSON.stringify(counts)}), ${inner.length} tiles fully inside the box`);
if (dryRun) process.exit(0);

const BATCH = 2000;
for (let i = 0; i < rows.length; i += BATCH) {
  const values = rows.slice(i, i + BATCH)
    .map(r => `(${r.id},'${r.kind}',${r.lat},${r.lon},'${r.tile}')`).join(',');
  await sql(`insert into public.road_features (osm_id, kind, lat, lon, tile) values ${values}
    on conflict (osm_id) do update set kind = excluded.kind, lat = excluded.lat, lon = excluded.lon, tile = excluded.tile;`);
  process.stdout.write(`features ${Math.min(i + BATCH, rows.length)}/${rows.length}\r`);
}
for (let i = 0; i < inner.length; i += BATCH) {
  const values = inner.slice(i, i + BATCH).map(t => `('${t}', now(), 'geofabrik')`).join(',');
  await sql(`insert into public.road_tiles (tile, fetched_at, source) values ${values}
    on conflict (tile) do update set fetched_at = now(), source = 'geofabrik';`);
}
console.log(`\nloaded ${rows.length} features and ${inner.length} tiles`);
