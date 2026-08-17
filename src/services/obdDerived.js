/**
 * Numbers the car doesn't actually report.
 *
 * Horsepower, torque and gear are the three things everyone wants off an OBD
 * dongle, and the honest position on each is different:
 *
 *   torque  — a real PID, but an optional one. 0x62 gives a PERCENTAGE and 0x63
 *             gives the reference figure it is a percentage OF. One without the
 *             other is meaningless, and plenty of cars expose neither.
 *   power   — not a PID on any car. It is arithmetic on torque and RPM.
 *   gear    — not a PID either. It is inferred from how engine speed relates to
 *             road speed, which is a fixed ratio per gear for any given car.
 *
 * Everything here is pure so it can be tested without a vehicle, and every
 * function returns null rather than a plausible-looking guess when the inputs
 * aren't there. A confidently wrong horsepower figure is worse than a blank.
 */

/**
 * Engine torque in Nm.
 *
 * @param pct  PID 0x62 — actual engine torque, as a percentage of reference
 * @param ref  PID 0x63 — reference torque in Nm
 *
 * The percentage is signed: on the overrun (engine braking, foot off) the ECU
 * reports negative torque, and that is real, not an error to clamp away.
 */
export function torqueNm(pct, ref){
  if (typeof pct !== 'number' || typeof ref !== 'number') return null;
  if (!Number.isFinite(pct) || !Number.isFinite(ref) || ref <= 0) return null;
  return (pct / 100) * ref;
}

/**
 * Horsepower from torque and engine speed.
 *
 * P(kW) = τ(Nm) × ω(rad/s), and with rpm→rad/s plus kW→hp the constant folds
 * to 7127: hp = τ × rpm / 7127.
 *
 * This is crank horsepower — what the engine makes, not what reaches the road.
 * Wheel horsepower is 12–15% lower, and the gap is drivetrain loss no dongle
 * can see, so don't relabel this later.
 */
export function horsepower(nm, rpm){
  if (typeof nm !== 'number' || typeof rpm !== 'number') return null;
  if (!Number.isFinite(nm) || !Number.isFinite(rpm) || rpm <= 0) return null;
  return (nm * rpm) / 7127;
}

/**
 * The engine-speed to road-speed ratio.
 *
 * Constant within a gear for a given car, which is what makes gear inference
 * possible without knowing anything about the vehicle.
 *
 * Below walking pace the ratio explodes toward infinity and means nothing — a
 * stationary car with the engine running is not in an infinitely tall gear — so
 * anything under 5 km/h returns null rather than poisoning a ratio cluster.
 */
export function speedRatio(rpm, speedKmh){
  if (typeof rpm !== 'number' || typeof speedKmh !== 'number') return null;
  if (!Number.isFinite(rpm) || !Number.isFinite(speedKmh)) return null;
  if (speedKmh < 5 || rpm <= 0) return null;
  return rpm / speedKmh;
}

/** Two ratios belong to the same gear if they're within this fraction. */
const RATIO_TOLERANCE = 0.12;

/**
 * Learn this car's gear ratios as it drives.
 *
 * No configuration, no vehicle database: gears reveal themselves as clusters of
 * repeated ratios. A new observation either joins the nearest cluster — nudging
 * its centre, so the estimate sharpens with use — or starts a new one.
 *
 * Returns a NEW array; callers hold the state so this stays pure and testable.
 */
export function learnRatio(clusters, ratio){
  const list = Array.isArray(clusters) ? clusters.map(c => ({ ...c })) : [];
  if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0) return list;

  let nearest = null, nearestDist = Infinity;
  for (const c of list){
    const dist = Math.abs(c.ratio - ratio) / c.ratio;
    if (dist < nearestDist){ nearestDist = dist; nearest = c; }
  }

  if (nearest && nearestDist <= RATIO_TOLERANCE){
    // Running mean: later observations refine the centre without letting one
    // noisy reading drag it.
    nearest.n     += 1;
    nearest.ratio += (ratio - nearest.ratio) / nearest.n;
  } else {
    list.push({ ratio, n: 1 });
  }

  // Tallest ratio = lowest gear. Sorting descending means the index IS the gear
  // number, which is why inference below is just a lookup.
  return list.sort((a, b) => b.ratio - a.ratio);
}

/**
 * Which gear, given what we've learned so far.
 *
 * Requires a cluster to have been seen a few times before it may name a gear: a
 * single observation is as likely to be a clutch slip or a shift in progress as
 * a real ratio, and flickering "6th" at someone mid-corner is worse than blank.
 */
export function inferGear(clusters, ratio, minObservations = 3){
  if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0) return null;
  const confident = (clusters || []).filter(c => c.n >= minObservations);
  if (!confident.length) return null;

  let best = null, bestDist = Infinity;
  confident.forEach((c) => {
    const dist = Math.abs(c.ratio - ratio) / c.ratio;
    if (dist < bestDist){ bestDist = dist; best = c; }
  });

  if (!best || bestDist > RATIO_TOLERANCE) return null;

  // Position among ALL known clusters, not just the confident ones — otherwise
  // the number shifts as new gears are learned and 4th silently becomes 3rd.
  const ordered = [...(clusters || [])].sort((a, b) => b.ratio - a.ratio);
  return ordered.findIndex(c => c.ratio === best.ratio) + 1;
}

/**
 * Everything derivable from one poll, in one call.
 *
 * `clusters` is carried by the caller across polls; this returns the updated set
 * alongside the readings so the learning survives without a module global.
 */
export function derive({ rpm, speedKmh, torquePct, torqueRef, clusters = [] } = {}){
  const nm    = torqueNm(torquePct, torqueRef);
  const hp    = horsepower(nm, rpm);
  const ratio = speedRatio(rpm, speedKmh);
  const next  = ratio == null ? clusters : learnRatio(clusters, ratio);

  return {
    torqueNm:   nm,
    horsepower: hp,
    ratio,
    gear:       ratio == null ? null : inferGear(next, ratio),
    clusters:   next,
  };
}
