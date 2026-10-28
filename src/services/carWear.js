/**
 * Car wear from your driving — what each drive did to the car, tallied so the
 * Concierge can say "lots of heavy braking these last 3 months: have the pads
 * measured" with the evidence attached.
 *
 * Every drive gets a small `wear` stamp (it survives storage stripping the
 * samples from old drives, like `points` does). The Concierge then sums the
 * stamps for one car over a window. Pure — no storage, no DOM.
 *
 * What a phone can honestly measure, and what it can't:
 *  - hard stops          brake events of tier 2+ (≈ 0.3 g and up)
 *  - long downhill runs  GPS altitude falling 150 m+ in one stretch — brake
 *                        heat; only drives recorded since altitude was added
 *  - pothole hits        a vertical jolt of ~1.5 g at 20 mph+, from the mount
 *  - short trips         under 10 minutes: the engine never warms up and the
 *                        battery never recharges
 *  - hard corners        turn events of tier 3+ (tire shoulders)
 * It can't see pad thickness or tread depth. Advice built on this says
 * "have it checked", never "your pads are at 30%".
 */
import { metersToMiles } from '../utils/math.js';

export const WEAR_VERSION = 1;
const HARD_STOP_TIER = 2;
const HARD_CORNER_TIER = 3;
const HIT_MPS2 = 15;            // ≈ 1.5 g above the road's own texture (1 g caught ordinary rough patches)
const HIT_MIN_MPS = 9;          // ~20 mph: slower than that it's a speed bump or a driveway
const HIT_GAP_MS = 5000;        // one pothole rattles several samples
const DESCENT_M = 150;          // ~500 ft of continuous drop
const DESCENT_REBOUND_M = 25;   // a rise this big ends the run
const SHORT_TRIP_MS = 10 * 60_000;

/** Long downhill runs in a drive: [{ dropM, t }] from the samples' altitude (al). */
export function descents(samples){
  const out = [];
  let top = null, low = null;
  for (const s of samples || []){
    if (s.al == null) continue;
    if (top == null){ top = low = s; continue; }
    if (s.al < low.al) low = s;
    else if (s.al - low.al >= DESCENT_REBOUND_M){
      if (top.al - low.al >= DESCENT_M) out.push({ dropM: Math.round(top.al - low.al), t: low.t });
      top = low = s;
    }
    if (s.al > top.al && low === top) top = low = s;
  }
  if (top && top.al - low.al >= DESCENT_M) out.push({ dropM: Math.round(top.al - low.al), t: low.t });
  return out;
}

/** The pothole-class hits in a drive: [{ t, lat, lon, mps2, mph }]. */
export function bigHits(samples){
  const out = [];
  for (const s of samples || []){
    if (!(s.rj >= HIT_MPS2) || !(s.speed >= HIT_MIN_MPS)) continue;
    const last = out[out.length - 1];
    if (last && s.t - last.t < HIT_GAP_MS){
      if (s.rj > last.mps2) Object.assign(last, { t: s.t, lat: s.lat, lon: s.lon, mps2: s.rj, mph: Math.round(s.speed * 2.237) });
      continue;
    }
    out.push({ t: s.t, lat: s.lat, lon: s.lon, mps2: s.rj, mph: Math.round(s.speed * 2.237) });
  }
  return out;
}

/** One drive's wear stamp. `vehicleId` is who the drive belongs to. */
export function driveWear(drive, vehicleId = null){
  const ev = drive.events || [];
  const smp = drive.samples || [];
  const hits = bigHits(smp);
  const desc = descents(smp);
  // What this drive can actually vouch for. A drive restored from the cloud
  // carries no samples or events; one whose samples were shed for storage
  // keeps its events (stops) but lost the jolts (hits). Counting their miles
  // as clean would be a false all-clear.
  const stopsEvid = !drive.restored && (smp.length > 0 || Boolean(drive.samplesDropped));
  const hitsEvid = smp.length > 0;
  return {
    v: WEAR_VERSION,
    vid: vehicleId,
    sim: Boolean(drive.simulated),
    stopsEvid, hitsEvid,
    mi: +metersToMiles(drive.distanceMeters || 0).toFixed(2),
    hardStops: ev.filter(e => e.type === 'brake' && (e.tier || 0) >= HARD_STOP_TIER).length,
    hardCorners: ev.filter(e => e.type === 'turn' && (e.tier || 0) >= HARD_CORNER_TIER).length,
    // Keep the worst three hits with where they happened, for the evidence line.
    hits: hits.length,
    hitList: hits.sort((a, b) => b.mps2 - a.mps2).slice(0, 3)
      .map(h => ({ ...h, mps2: +h.mps2.toFixed(1), lat: +(+h.lat).toFixed(5), lon: +(+h.lon).toFixed(5) })),
    descents: desc.length,
    descentM: desc.reduce((s, d) => s + d.dropM, 0),
    hasAlt: smp.some(s => s.al != null),
    short: (drive.durationMs || 0) > 0 && drive.durationMs < SHORT_TRIP_MS,
  };
}

/**
 * Stamp drives that have no (current) wear stamp. Drives recorded before cars
 * were tagged go to `fallbackVid` — the active car — which is right for the
 * one-car driver and the best guess otherwise. Mutates; true if any changed.
 */
export function stampWear(drives, fallbackVid = null){
  let changed = false;
  for (const d of drives){
    if (d.wear?.v === WEAR_VERSION){
      // Recorded before any car was in the garage: give it to the first one.
      if (d.wear.vid == null && fallbackVid != null && !d.wear.sim){ d.wear.vid = fallbackVid; changed = true; }
      continue;
    }
    d.wear = driveWear(d, d.vehicleId ?? fallbackVid);
    changed = true;
  }
  return changed;
}

const DAY = 86_400_000;
const startOf = d => d.startTime ?? d.drivenAt ?? d.ts ?? 0;

/**
 * One car's wear over the last `days` days: totals, rates per 100 miles, and
 * the worst pothole hits with when they happened.
 */
export function wearWindow(drives, vid, days, now = Date.now()){
  const mine = drives.filter(d => d.wear && !d.wear.sim && (d.wear.vid ?? null) === (vid ?? null) && now - startOf(d) <= days * DAY);
  const sum = (k, ds = mine) => ds.reduce((s, d) => s + (d.wear[k] || 0), 0);
  // Rates only over the miles that could have shown the thing being counted.
  const stopsDs = mine.filter(d => d.wear.stopsEvid !== false);
  const hitsDs = mine.filter(d => d.wear.hitsEvid !== false);
  const mi = sum('mi', stopsDs);
  const hitMi = sum('mi', hitsDs);
  const hitList = hitsDs.flatMap(d => (d.wear.hitList || []).map(h => ({ ...h, at: startOf(d) + (h.t || 0) })))
    .sort((a, b) => b.mps2 - a.mps2);
  return {
    days, drives: mine.length, mi, hitMi,
    hardStops: sum('hardStops'), hardCorners: sum('hardCorners'),
    hits: sum('hits'), hitList,
    descents: sum('descents'), descentM: sum('descentM'),
    withAlt: mine.filter(d => d.wear.hasAlt).length,
    shortTrips: mine.filter(d => d.wear.short).length,
    per100: k => (mi > 0 ? (sum(k) / mi) * 100 : 0),
  };
}
