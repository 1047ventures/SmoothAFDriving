// Typical-traffic backfill for drives recorded before traffic was read (or
// whose read failed). Live traffic only exists in the minutes after a drive, so
// older drives get an ESTIMATE instead: the same trip at the same weekday and
// time next week, which Mapbox predicts from typical traffic. Stored with
// `estimated: true` so the recap can say "usual traffic", not "measured".
//
// Runs at launch, a batch at a time, in the background: all the Mapbox lookups
// first, then one read-patch-write of the stored list.
import { fetchTypicalTrafficRatio, isTrafficAware } from './routing.js';
import { loadDrives, saveDrives, recomputeLifetimeScore } from './storage.js';
import { applyAnalysis } from './drive.js';
import { analyzeDrive } from './scoring.js';
import { haversine } from '../utils/math.js';
import { TRAFFIC_FRESH_MS, TRAFFIC_MIN_TRIP_M, TRAFFIC_MIN_FREE_SEC } from '../constants.js';

const MAX_TRIES = 3;   // a drive Mapbox can't route after this many launches gets no reading

// Start and end of the drive's track, or null if it has none worth pricing.
export function tripEnds(drive){
  const pts = (drive.samples || []).filter(s => s.lat != null && s.lon != null);
  if (pts.length < 2) return null;
  const a = pts[0], b = pts[pts.length - 1];
  return haversine(a, b) >= TRAFFIC_MIN_TRIP_M ? { a, b } : null;
}

// No reading yet — or a live one taken against the old midday yardstick (pre-3am
// baseline, no `base`), which under-read rush hour; those get re-estimated.
const unread = (t) => t === undefined || (t !== null && !t.base && !t.estimated);

export function needsTraffic(drive, now = Date.now()){
  return unread(drive.traffic) && !drive.simulated && drive.startTime != null
    && (drive.samples?.length || 0) >= 2
    && now - (drive.startTime + (drive.durationMs || 0)) > TRAFFIC_FRESH_MS;   // the live read owns fresh drives
}

export async function backfillTypicalTraffic({ limit = 15, now = Date.now(), fetchRatio = fetchTypicalTrafficRatio } = {}){
  if (fetchRatio === fetchTypicalTrafficRatio && !isTrafficAware()) return null;

  // 1. Network first, off the stored list: ask Mapbox about each drive.
  const todo = loadDrives().filter(d => needsTraffic(d, now)).slice(0, limit);
  const found = new Map();   // startTime -> ratio | null (nothing to price) | undefined (lookup failed)
  for (const d of todo){
    const ends = tripEnds(d);
    found.set(d.startTime, ends ? await fetchRatio({ lat: ends.a.lat, lng: ends.a.lon }, { lat: ends.b.lat, lng: ends.b.lon }, d.startTime) ?? undefined : null);
  }
  if (!found.size) return { checked: 0, estimated: 0, changed: 0, avgDelta: 0 };

  // 2. One read-patch-write onto a fresh copy (no awaits in between), so a drive
  //    finished, deleted or annotated meanwhile is never overwritten by a stale one.
  const all = loadDrives();
  let estimated = 0, changed = 0, delta = 0;
  for (const d of all){
    if (!found.has(d.startTime) || !needsTraffic(d, now)) continue;
    const tr = found.get(d.startTime);
    if (tr === undefined){                                    // Mapbox failed: retry next launch, a few times
      d.trafficTries = (d.trafficTries || 0) + 1;
      if (d.trafficTries < MAX_TRIES) continue;
    }
    const usable = tr && tr.freeSec >= TRAFFIC_MIN_FREE_SEC;
    const before = d.score;
    d.traffic = usable ? { ...tr, estimated: true, at: now } : null;   // null = a loop, a hop, or unroutable
    delete d.trafficTries;
    applyAnalysis(d, analyzeDrive(d));                        // also clears an old-yardstick reading's effect
    if (usable){
      estimated++;
      if (before != null && d.score !== before){ changed++; delta += d.score - before; }
    }
  }
  saveDrives(all);
  if (estimated) recomputeLifetimeScore();
  return { checked: found.size, estimated, changed, avgDelta: changed ? +(delta / changed).toFixed(1) : 0 };
}
