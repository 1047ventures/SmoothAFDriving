// Smooth AF points — the two-layer model from the vision:
//   1. BASE: you bank points for every SMOOTH mile, destination or not.
//   2. BONUS: beating the ETA stacks on top, but only if you stayed smooth.
//      Rough-but-fast earns nothing extra.
//   3. TRAFFIC: the same smooth mile in rush hour is harder than on an empty
//      road, so it earns up to +50% more (drive.traffic, read after the drive).
//
// A mile is "smooth" when no harsh event fired near it: each recorded event
// blacks out the road within ±EVENT_WINDOW_MS of it. Drives restored without
// samples (metadata-only) fall back to their efficiency score as a proxy.
// Pure — no storage, no DOM.
import { haversine, metersToMiles, clamp } from '../utils/math.js';
import {
  POINTS_PER_SMOOTH_MILE, POINTS_EVENT_WINDOW_MS, POINTS_SMOOTH_GATE,
  POINTS_PACE_BONUS_MAX, CLOCK_BEAT_FULL, ETA_BUFFER,
  TRAFFIC_MIN_RATIO, TRAFFIC_FULL_RATIO, TRAFFIC_BONUS_MAX,
} from '../constants.js';

// Miles of the drive that were driven clean. Returns { smoothMi, totalMi }.
export function smoothMiles(drive){
  const totalMi = metersToMiles(drive.distanceMeters || 0);
  const smp = (drive.samples || []).filter(s => s.lat != null && s.lon != null && s.t != null);
  if (smp.length < 2){
    // No track to walk — scale the distance by how smooth the drive scored.
    const eff = drive.efficiency ?? drive.score ?? 0;
    return { smoothMi: totalMi * clamp((eff - 50) / 40, 0, 1), totalMi };
  }

  const evTimes = (drive.events || []).map(e => e.t).filter(t => t != null).sort((a, b) => a - b);
  const nearEvent = (t) => {
    // Binary search for the nearest event time.
    let lo = 0, hi = evTimes.length - 1;
    while (lo <= hi){
      const mid = (lo + hi) >> 1;
      if (Math.abs(evTimes[mid] - t) <= POINTS_EVENT_WINDOW_MS) return true;
      if (evTimes[mid] < t) lo = mid + 1; else hi = mid - 1;
    }
    return false;
  };

  let walked = 0, clean = 0;
  for (let i = 1; i < smp.length; i++){
    const d = haversine(smp[i - 1], smp[i]);
    walked += d;
    if (!nearEvent((smp[i - 1].t + smp[i].t) / 2)) clean += d;
  }
  // Scale to the drive's official distance so smoothMi never exceeds totalMi
  // even if the stored track was thinned or jittered.
  const frac = walked > 0 ? clean / walked : 0;
  return { smoothMi: totalMi * frac, totalMi };
}

// ETA bonus multiplier (0..POINTS_PACE_BONUS_MAX). Zero unless the driver
// arrived, beat the buffered ETA, AND stayed smooth.
export function paceBonusFrac(drive){
  const eta = drive.targetEtaSec, actual = drive.movingSec;
  if (!drive.arrived || !(eta > 0) || !(actual > 0)) return 0;
  if ((drive.efficiency ?? 0) < POINTS_SMOOTH_GATE) return 0;
  const target = eta * (drive.etaBuffer || ETA_BUFFER);
  const margin = (target - actual) / target;
  if (margin < 0) return 0;
  return POINTS_PACE_BONUS_MAX * Math.min(1, margin / CLOCK_BEAT_FULL);
}

// Traffic multiplier (0..TRAFFIC_BONUS_MAX), scaled linearly from the floor
// ratio to the full one. It multiplies the smooth-mile base, so only the miles
// you drove clean get the credit — rough driving in a jam earns nothing extra.
export function trafficBonusFrac(drive){
  const r = drive.traffic?.ratio;
  if (!(r >= TRAFFIC_MIN_RATIO)) return 0;
  return TRAFFIC_BONUS_MAX * Math.min(1, (r - TRAFFIC_MIN_RATIO) / (TRAFFIC_FULL_RATIO - TRAFFIC_MIN_RATIO));
}

// Full points breakdown for one drive.
export function drivePoints(drive){
  const { smoothMi, totalMi } = smoothMiles(drive);
  const base    = Math.round(smoothMi * POINTS_PER_SMOOTH_MILE);
  const bonus   = Math.round(base * paceBonusFrac(drive));
  const traffic = Math.round(base * trafficBonusFrac(drive));
  return { smoothMi, totalMi, base, bonus, traffic, total: base + bonus + traffic };
}

// Points for a drive, preferring the breakdown stamped at finalize time.
export function pointsFor(drive){
  return drive.points?.total ?? drivePoints(drive).total;
}

export function lifetimePoints(drives){
  return drives.reduce((s, d) => s + pointsFor(d), 0);
}

// One-time-per-drive stamp for drives recorded before points existed. Storage
// strips samples from the oldest drives under quota, which would silently move
// them onto the fallback estimate — stamping now freezes the walked figure.
// Mutates the drives in place; returns true if any were stamped.
export function stampMissingPoints(drives){
  let changed = false;
  for (const d of drives){
    if (d.points || d.score == null) continue;
    d.points = drivePoints(d);
    changed = true;
  }
  return changed;
}
