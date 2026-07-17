import { haversine } from '../utils/math.js';
import { upsertCorridorDrive } from './storage.js';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';
const MIN_SEGMENT_METERS = 500;

// ── Pure helpers (exported for tests) ────────────────────────────────────────

// Corridor identity is the road NAME ONLY — not name+city. The same road driven
// from different entrances/start-cities (e.g. "Denver-Boulder Turnpike" entered
// from Denver vs Broomfield vs Boulder) must resolve to ONE corridor. `city` is
// kept as a display/metadata field (see upsertCorridorDrive), not part of the id.
//
// Known limitation (acceptable for v1): two genuinely different roads that
// happen to share a name in different areas will now merge into one corridor.
// A future refinement could add a region/route-ref qualifier to disambiguate.
export function slugifyCorridorId(name){
  return `${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Sample one GPS point per ~250m of cumulative distance, capped at maxPoints. */
export function sampleGpsPoints(samples, maxPoints = 25){
  if (!samples.length) return [];
  const INTERVAL = 250;
  const result = [samples[0]];
  let accumulated = 0;
  for (let i = 1; i < samples.length; i++){
    accumulated += haversine(samples[i - 1], samples[i]);
    if (accumulated >= INTERVAL){
      result.push(samples[i]);
      accumulated = 0;
      if (result.length >= maxPoints) break;
    }
  }
  return result;
}

// ── Overpass: one union query for all sample points ───────────────────────────

async function fetchRoadNamesForPoints(points){
  const parts = points
    .map(p => `  way(around:50,${p.lat.toFixed(5)},${p.lon.toFixed(5)})[highway][name];`)
    .join('\n');
  const query = `[out:json][timeout:20];\n(\n${parts}\n);\nout tags center;`;
  const res = await fetch(`${OVERPASS}?data=${encodeURIComponent(query)}`);
  if (!res.ok) return [];
  const { elements = [] } = await res.json();
  return elements;
}

// ── City name from Nominatim ──────────────────────────────────────────────────

async function fetchCityForPoint(lat, lon){
  const res = await fetch(
    `${NOMINATIM}?format=json&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&zoom=10`,
    { headers: { 'Accept-Language': 'en', 'User-Agent': 'SmoothAFDriving/1.0' } }
  );
  if (!res.ok) return 'Unknown';
  const data = await res.json();
  return data.address?.city || data.address?.town || data.address?.county || 'Unknown';
}

// ── Assign each sample point to its nearest road ──────────────────────────────

function assignRoadNames(points, roads){
  return points.map(p => {
    let bestRoad = null, bestDist = Infinity;
    for (const road of roads){
      if (!road.center || !road.tags?.name) continue;
      const d = haversine(p, road.center);
      if (d < bestDist){ bestDist = d; bestRoad = road; }
    }
    return { ...p, roadName: bestDist < 1000 ? bestRoad?.tags?.name || null : null, osmWayId: bestRoad?.id || null, center: bestRoad?.center || null };
  });
}

// ── Group consecutive same-road points into segments ─────────────────────────

function groupIntoSegments(labeled){
  const segments = [];
  let current = null;
  for (const pt of labeled){
    if (!pt.roadName){ current = null; continue; }
    if (!current || current.name !== pt.roadName){
      current = { name: pt.roadName, osmWayId: pt.osmWayId, center: pt.center, points: [pt] };
      segments.push(current);
    } else {
      current.points.push(pt);
    }
  }
  return segments;
}

// ── Compute segment distance and filter by minimum ───────────────────────────

function filterSegments(segments){
  return segments
    .map(seg => {
      let dist = 0;
      for (let i = 1; i < seg.points.length; i++) dist += haversine(seg.points[i - 1], seg.points[i]);
      return { name: seg.name, osmWayId: seg.osmWayId, center: seg.center, distanceMeters: dist };
    })
    .filter(seg => seg.distanceMeters >= MIN_SEGMENT_METERS);
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Detect which named road corridors a drive covered.
 * Runs post-drive, non-blocking. Upserts matches into localStorage.
 * @param {object} drive  — finalized drive object with .samples and .score
 */
export async function detectCorridors(drive){
  const samples = drive.samples || [];
  if (samples.length < 10) return;

  const points = sampleGpsPoints(samples, 25);
  if (points.length < 2) return;

  let roads = [];
  try { roads = await fetchRoadNamesForPoints(points); } catch { return; }
  if (!roads.length) return;

  const labeled   = assignRoadNames(points, roads);
  const segments  = groupIntoSegments(labeled);
  const corridors = filterSegments(segments);
  if (!corridors.length) return;

  const startPt = points[0];
  let city = 'Unknown';
  try { city = await fetchCityForPoint(startPt.lat, startPt.lon); } catch {}

  for (const c of corridors){
    upsertCorridorDrive({
      name:            c.name,
      city,
      centerLat:       c.center?.lat ?? startPt.lat,
      centerLon:       c.center?.lon ?? startPt.lon,
      osmWayId:        c.osmWayId,
      score:           drive.score,
      distanceMeters:  c.distanceMeters,
      drivenAt:        drive.startTime,
    });
  }
}
