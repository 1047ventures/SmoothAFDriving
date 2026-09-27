import {
  CFG,
  TIER_MULT,
  DIM_WEIGHTS,
  ETA_BUFFER,
  PACE_PENALTY,
  CLOCK_MAX_SWING,
  CLOCK_BEAT_FULL,
  CLOCK_LATE_FULL,
  SCORE_MAX,
  PIT_SPEED_MPS,
  PIT_STOP_MS,
  SMOOTH_LA_LO,
  SMOOTH_LA_HI,
  SMOOTH_JERK_LO,
  SMOOTH_JERK_HI,
  MOMENTUM_STOP_MAX,
  SPEED_DIFF_LO_MPH,
  SPEED_DIFF_HI_MPH,
  SPEED_BONUS_MAX,
  RIDE_RR_LO,
  RIDE_RR_HI,
  NO_RIDE_DATA_CEILING,
} from '../constants.js';
import { clamp, linMap, pct, mpsToMph, metersToMiles, fmtDuration } from '../utils/math.js';

export function analyzeDrive(drive){
  const smp = drive.samples || [];
  const n   = smp.length;
  if (n < 3){
    const dims = { smoothness:85, braking:85, momentum:85 };
    return { score:85, dims, fullStops:0, stopsPerMile:0, longFlipsPerMin:0, latFlipsPerMin:0, p90Harshness:0, transitionScore:85, speedBonus:0, stopMarkers:[] };
  }

  const durationMin = (drive.durationMs || 0) / 60000;
  const distanceMi  = metersToMiles(drive.distanceMeters || 0);

  // Moving samples only (speed > 2 m/s ≈ 4.5 mph) — GPS accel is noise below that.
  const moving = smp.filter(s => (s.speed || 0) > 2);

  // ── 1. Smoothness — LONGITUDINAL only ────────────────────────────────────
  // Accel/brake, never lateral: lateral comes from GPS heading change, which
  // jitters and used to manufacture phantom "sharp turns". Two honest signals:
  //   · p85 of |longitudinal g| — how hard you push the car most of the time
  //   · mean |jerk| — how abruptly you transition between pedal phases
  const laSorted = moving.map(s => Math.abs(s.la || 0)).sort((a,b) => a - b);
  const p85la    = pct(laSorted, 85);
  const smoothLong = clamp(linMap(p85la, SMOOTH_LA_LO, SMOOTH_LA_HI, 100, 0), 0, 100);

  let jerkSum = 0, jerkN = 0;
  for (let i = 1; i < n; i++){
    if ((smp[i].speed || 0) <= 2) continue;
    const dt = Math.max(0.1, (smp[i].t - smp[i-1].t) / 1000);
    jerkSum += Math.abs(((smp[i].la || 0) - (smp[i-1].la || 0)) / dt);
    jerkN++;
  }
  const meanJerk   = jerkN > 0 ? jerkSum / jerkN : 0;
  const smoothJerk = clamp(linMap(meanJerk, SMOOTH_JERK_LO, SMOOTH_JERK_HI, 100, 0), 0, 100);

  // Ride composure — how calm the cabin actually was, from the 60 Hz accelerometer
  // (vertical+pitch RMS stored per sample as `rr`). This is the passenger's-eye
  // view: rumble strips, wind/truck buffeting and road texture all spike it, so a
  // jostled ride can't score smooth even when the pedal inputs were gentle. It's
  // present only when the motion sensor calibrated — a GPS-only drive has no `rr`,
  // so ride quality goes unmeasured (and the composite is capped below, since we
  // can't credit a calm we never sensed).
  const rrVals  = moving.map(s => s.rr).filter(v => v != null && v > 0).sort((a,b) => a - b);
  const hasRide = rrVals.length >= Math.max(10, moving.length * 0.3);
  const rideComposure = hasRide
    ? clamp(linMap(pct(rrVals, 85), RIDE_RR_LO, RIDE_RR_HI, 100, 0), 0, 100)
    : null;

  // With a ride measurement, composure is a full quarter of smoothness — a rough
  // ride visibly costs. Without it, the two pedal-based signals carry smoothness.
  const smoothness = hasRide
    ? Math.round(0.40 * smoothLong + 0.30 * smoothJerk + 0.30 * rideComposure)
    : Math.round(0.60 * smoothLong + 0.40 * smoothJerk);

  // ── 2. Braking Anticipation — approach quality for each stop ─────────────
  const STOP_ENTRY = 2.2;
  const STOP_EXIT  = 0.9;
  const LOOK_BACK  = 30;
  let stopScores = [], wasMoving = false;
  for (let i = 1; i < n; i++){
    if ((smp[i-1].speed || 0) > STOP_ENTRY) wasMoving = true;
    if (wasMoving && (smp[i].speed || 0) < STOP_EXIT){
      wasMoving = false;
      const start = Math.max(0, i - LOOK_BACK);
      let decelSum = 0, decelN = 0;
      for (let j = start; j < i; j++){
        const la = smp[j].la || 0;
        if (la < 0){ decelSum += Math.abs(la); decelN++; }
      }
      const approachLen  = i - start;
      const avgDecel     = decelN > 0 ? decelSum / decelN : 0;
      const lenScore   = clamp(linMap(approachLen, 5, 20, 0, 100), 0, 100);
      const decelScore = clamp(linMap(avgDecel, 2.0, 0.5, 0, 100), 0, 100);
      stopScores.push((lenScore + decelScore) / 2);
    }
  }
  const braking = stopScores.length > 0
    ? Math.round(stopScores.reduce((a,b) => a+b, 0) / stopScores.length)
    : 85;

  // ── 3. Momentum Management — full stops per mile ─────────────────────────
  const STOP_SPD = 0.5;
  const STOP_MS  = 1500;
  let fullStops = 0, stopStartIdx = -1;
  const stopMarkers = [];
  function recordStop(startIdx, endIdx){
    const durMs = smp[endIdx].t - smp[startIdx].t;
    if (durMs < STOP_MS) return;
    fullStops++;
    const mid = Math.round((startIdx + endIdx) / 2);
    const approachIdx = Math.max(0, startIdx - 1);
    stopMarkers.push({
      lat: smp[mid].lat, lon: smp[mid].lon,
      t: smp[startIdx].t, durationMs: durMs,
      speedMph: Math.round(mpsToMph(smp[approachIdx].speed || 0))
    });
  }
  for (let i = 0; i < n; i++){
    const spd = smp[i].speed || 0;
    if (spd < STOP_SPD && stopStartIdx < 0)  stopStartIdx = i;
    if (spd >= STOP_SPD && stopStartIdx >= 0){ recordStop(stopStartIdx, i); stopStartIdx = -1; }
  }
  if (stopStartIdx >= 0) recordStop(stopStartIdx, n - 1);
  const stopsPerMile = distanceMi > 0 ? fullStops / distanceMi : 0;
  const momentum = Math.round(clamp(linMap(stopsPerMile, 0, MOMENTUM_STOP_MAX, 100, 0), 0, 100));

  // ── Composite + speed difficulty multiplier ──────────────────────────────
  const dims = { smoothness, braking, momentum };
  const base = Object.entries(DIM_WEIGHTS).reduce((s, [k,w]) => s + (dims[k] || 0) * w, 0);
  // Staying smooth at speed is harder, so it earns a bonus — gated by the base
  // score so a sloppy-but-fast drive gets almost none.
  const movAvgMph  = moving.length > 0 ? mpsToMph(moving.reduce((s,x) => s+(x.speed||0), 0) / moving.length) : 0;
  const speedFactor = clamp(linMap(movAvgMph, SPEED_DIFF_LO_MPH, SPEED_DIFF_HI_MPH, 0, 1), 0, 1);
  const speedBonus  = SPEED_BONUS_MAX * speedFactor * (base / 100);
  // A perfect 100 is meant to be nearly impossible. A drive we couldn't measure
  // for ride quality (GPS-only) can't be certified calm, so it's capped short of
  // the top; only a drive the sensors confirmed as smooth can approach 100.
  const ceiling = hasRide ? 100 : NO_RIDE_DATA_CEILING;
  const score = Math.round(clamp(base + speedBonus, 0, ceiling));

  // Kept for the review "Transitions" info stat (jerk quality) — informational,
  // no longer a scored dimension.
  const transitionScore = Math.round(smoothJerk);
  // Legacy fields some UI/coaching still reads; lateral flips are no longer scored.
  const longFlipsPerMin = 0, latFlipsPerMin = 0, p90H = p85la;

  // ── Extended stats ─────────────────────────────────────────────────────────

  // Peak + avg G per event type
  function peakAvgG(evts, field){
    if (!evts.length) return { peak: null, avg: null, peakEv: null };
    const sorted = [...evts].sort((a,b) => Math.abs(b[field]||0) - Math.abs(a[field]||0));
    const peak = +(Math.abs(sorted[0][field]||0) / 9.81).toFixed(2);
    const avg  = +(evts.reduce((s,e) => s + Math.abs(e[field]||0), 0) / evts.length / 9.81).toFixed(2);
    return { peak, avg, peakEv: sorted[0] };
  }
  const brakeEvs = drive.events.filter(e => e.type === 'brake' && e.la != null);
  const accelEvs = drive.events.filter(e => e.type === 'accel' && e.la != null);
  const turnEvs  = drive.events.filter(e => e.type === 'turn'  && e.ra != null);
  const brakeG = peakAvgG(brakeEvs, 'la');
  const accelG = peakAvgG(accelEvs, 'la');
  const turnG  = peakAvgG(turnEvs,  'ra');

  // Smoothness streak — longest gap between tier-2+ events (approx, using avg speed)
  const avgSpeedMps = n > 0 ? smp.reduce((s,x) => s+(x.speed||0), 0) / n : 0;
  const tier2Evs = drive.events
    .filter(e => e.type !== 'shift' && (e.tier||2) >= 2)
    .sort((a,b) => a.t - b.t);
  const driveEndT = n > 0 ? smp[n-1].t : 0;
  const checkpoints = [0, ...tier2Evs.map(e => e.t), driveEndT];
  let maxStreakMs = 0;
  for (let i = 1; i < checkpoints.length; i++) maxStreakMs = Math.max(maxStreakMs, checkpoints[i] - checkpoints[i-1]);
  const smoothStreakMi = +metersToMiles(avgSpeedMps * maxStreakMs / 1000).toFixed(2);

  // Harsh events per mile
  const harshEvs   = tier2Evs.filter(e => e.type !== 'shift');
  const harshPerMi = distanceMi > 0.1 ? +(harshEvs.length / distanceMi).toFixed(1) : null;

  // Coasting ratio — moving samples where |la|<0.3 AND |ra|<0.4
  let movingN = 0, coastN = 0;
  for (const s of smp){
    if ((s.speed||0) < 2) continue;
    movingN++;
    if (Math.abs(s.la||0) < 0.3 && Math.abs(s.ra||0) < 0.4) coastN++;
  }
  const coastPct = movingN > 0 ? Math.round(coastN / movingN * 100) : null;

  // Speed stats (moving only)
  const movingSpeeds = smp.filter(s => (s.speed||0) > 2).map(s => mpsToMph(s.speed));
  const avgSpeedMph = movingSpeeds.length > 0
    ? Math.round(movingSpeeds.reduce((a,b) => a+b, 0) / movingSpeeds.length) : 0;
  const speedVariance = movingSpeeds.length > 1
    ? movingSpeeds.reduce((s,v) => s + (v-avgSpeedMph)**2, 0) / movingSpeeds.length : 0;
  const speedStdDevMph = +Math.sqrt(speedVariance).toFixed(1);

  // Speed vs posted limit
  const limitMps    = drive.speedLimitMps || null;
  const limitMph    = limitMps ? Math.round(mpsToMph(limitMps)) : null;
  const avgVsLimit  = limitMph != null ? +(avgSpeedMph - limitMph) : null;
  let secAboveLimit = null;
  if (limitMps != null){
    let secs = 0;
    for (let i = 1; i < n; i++){
      if ((smp[i].speed||0) > limitMps * 1.05) secs += (smp[i].t - smp[i-1].t) / 1000;
    }
    secAboveLimit = Math.round(secs);
  }

  // Shift count
  const shiftCount = drive.events.filter(e => e.type === 'shift').length;

  // Hard-brake entry speed — avg speed when tier-2+ brake events occurred
  const hardBrakes = brakeEvs.filter(e => (e.tier||2) >= 2);
  const hardBrakeEntryMph = hardBrakes.length > 0
    ? Math.round(hardBrakes.reduce((s,e) => s + (e.speedMph||0), 0) / hardBrakes.length) : null;

  // Letter grade
  const g = score;
  const letterGrade = g >= 97 ? 'A+' : g >= 93 ? 'A' : g >= 90 ? 'A-'
    : g >= 87 ? 'B+' : g >= 83 ? 'B' : g >= 80 ? 'B-'
    : g >= 77 ? 'C+' : g >= 73 ? 'C' : g >= 70 ? 'C-'
    : g >= 60 ? 'D' : 'F';

  return {
    score, dims, fullStops, stopsPerMile: +stopsPerMile.toFixed(2),
    stopMarkers,
    longFlipsPerMin: +longFlipsPerMin.toFixed(1),
    latFlipsPerMin:  +latFlipsPerMin.toFixed(1),
    p90Harshness:    +p90H.toFixed(2),
    transitionScore,
    speedBonus:      +speedBonus.toFixed(1),
    rideComposure,   // null on GPS-only drives (ride quality unmeasured)
    // extended
    peakBrakeG: brakeG.peak,  avgBrakeG: brakeG.avg,  peakBrakeEv: brakeG.peakEv,
    peakAccelG: accelG.peak,  avgAccelG: accelG.avg,  peakAccelEv: accelG.peakEv,
    peakTurnG:  turnG.peak,   avgTurnG:  turnG.avg,   peakTurnEv:  turnG.peakEv,
    smoothStreakMi,
    harshPerMi,
    coastPct,
    avgSpeedMph,
    speedStdDevMph,
    limitMph,
    avgVsLimit,
    secAboveLimit,
    shiftCount,
    hardBrakeEntryMph,
    letterGrade,
  };
}

export function driveCoaching(analysis){
  const { dims, stopsPerMile, fullStops } = analysis;
  const cards = [];

  // Worst 2 dimensions below threshold → warning cards
  const ranked = Object.entries(dims).sort((a,b) => a[1] - b[1]);
  let warned = 0;
  for (const [key, score] of ranked){
    if (warned >= 2 || score >= 70) break;
    const texts = {
      smoothness: { title: 'Harsh inputs detected',
        body: `Your accel and braking ran firm — aim to feather the pedals and blend smoothly between them. Passengers feel every abrupt push.` },
      braking:    { title: 'Late braking',
        body: `Stops came with short approach distances and sharp decel. Spot brake zones earlier and ease in gradually over a longer runway.` },
      momentum:   { title: `${fullStops} full stop${fullStops !== 1 ? 's' : ''}`,
        body: `${stopsPerMile.toFixed(1)} stops/mile. Read lights and traffic to maintain a rolling pace — the goal is to never fully stop.` },
    };
    if (texts[key]){ cards.push({ type: 'warning', ...texts[key] }); warned++; }
  }

  // Best dimension ≥ 80 → positive card
  const [bestKey, bestScore] = ranked[ranked.length - 1];
  if (bestScore >= 80){
    const praise = {
      smoothness: { title: 'Impressively smooth inputs',
        body: `Gentle on the accelerator and brakes, blended cleanly between them. Passengers felt barely a ripple.` },
      braking:    { title: 'Excellent braking anticipation',
        body: `Long, gentle approaches to every stop — exactly what the car and your passengers want.` },
      momentum:   { title: 'Excellent momentum management',
        body: `Only ${fullStops} full stop${fullStops !== 1 ? 's' : ''} (${stopsPerMile.toFixed(1)}/mile). You read the road and kept rolling.` },
    };
    if (praise[bestKey]) cards.push({ type: 'positive', ...praise[bestKey] });
  }

  if (!cards.length)
    cards.push({ type: 'positive', title: 'Smooth AF', body: 'Strong across the board — smooth inputs, clean stops, steady momentum. Your passengers felt the difference.' });

  return cards;
}

// A TIGHT, qualitative recap of how the drive went down — no numbers (those live
// in driveFacts() and the stat blocks). One line for the trip's character, and a
// second only when the drive earns it (a rough patch, beating the clock). It reads
// the SHAPE of the trip: a quick neighborhood hop vs a highway run vs a stop-and-go
// crawl. `ctx` carries cross-drive context. Pure + testable. Returns sentences.
export function driveNarrative(drive, analysis, driverName, ctx = {}){
  const out = [];
  const seed = Math.abs(Math.round(drive.startTime || 0));
  const pick = arr => arr[seed % arr.length];
  const first = (driverName || '').trim().split(/\s+/)[0] || '';

  const durMs   = drive.durationMs || 0;
  const durMin  = Math.max(1, Math.round(durMs / 60000));
  const miNum   = metersToMiles(drive.distanceMeters || 0);
  const dest    = drive.destination?.label ? drive.destination.label.split(',')[0].trim() : null;
  const arrived = !!(dest && drive.arrived);

  const dims      = analysis.dims || {};
  const topMph    = Math.round(mpsToMph(drive.topSpeedMps || 0));
  const avgMph    = analysis.avgSpeedMph || (miNum > 0 && durMs > 0 ? Math.round(miNum / (durMs / 3600000)) : 0);
  const isShort   = miNum < 3 && durMin <= 12 && !arrived;
  const isHighway = topMph >= 55 && avgMph >= 38;
  const stopAndGo = (dims.momentum ?? 100) < 60 || (analysis.stopsPerMile || 0) >= 2.5;
  const eff       = analysis.score ?? drive.efficiency ?? 0;

  // Line 1 — trip type + pace + how clean it felt (all qualitative)
  const tripType = arrived   ? `Run over to ${dest}`
                 : dest      ? `Headed for ${dest}`
                 : isShort   ? pick(['Quick neighborhood hop', 'Short local run', 'Little errand'])
                 : isHighway ? 'Highway run'
                 :             'City drive';
  const pace = isHighway ? 'open and flowing' : stopAndGo ? 'stop-and-go' : 'steady and flowing';
  const allHands = ['smoothness', 'braking'].every(k => (dims[k] ?? 0) >= 95);
  let smooth;
  if (allHands)        smooth = stopAndGo ? ', but your hands stayed dialed' : ', hands totally dialed';
  else if (eff >= 88)  smooth = ', kept it silky';
  else if (eff >= 78)  smooth = ', kept it clean';
  else if (eff < 66)   smooth = ', a little rough around the edges';
  else                 smooth = '';
  out.push(`${tripType}${first ? `, ${first}` : ''} — ${pace}${smooth}.`);

  // Line 2 — expand ONLY when the drive earns it: the clock and/or the rough patch.
  const harsh = (drive.events || []).filter(e => e.type !== 'shift' && (e.tier || 2) >= 2)
    .slice().sort((a, b) => (a.t || 0) - (b.t || 0));
  const posWord = t => { const f = durMs ? (t || 0) / durMs : 0; return f < 0.34 ? 'early on' : f < 0.67 ? 'mid-drive' : 'near the end'; };
  const firm = t => t === 'brake' ? 'firm brake' : t === 'accel' ? 'hard pull' : 'sharp turn';

  let clockLine = null;
  if (drive.effectiveness != null && drive.targetEtaSec > 0 && !isShort){
    const targetMs = drive.targetEtaSec * (drive.etaBuffer ?? ETA_BUFFER) * 1000;
    const usedMs   = drive.movingSec != null ? drive.movingSec * 1000 : durMs;
    const diff     = usedMs - targetMs;
    clockLine = diff <= -60000 ? pick(['Beat the ETA with room to spare.', 'Came in ahead of the clock.'])
              : diff <= 45000  ? 'Right on schedule.'
              :                  'Came in behind the ETA.';
  }

  let hiccupLine = null;
  if (harsh.length === 1){
    hiccupLine = `One ${firm(harsh[0].type)} ${posWord(harsh[0].t)}, otherwise clean.`;
  } else if (harsh.length > 1){
    const span = (harsh[harsh.length - 1].t || 0) - (harsh[0].t || 0);
    const mid  = ((harsh[0].t || 0) + (harsh[harsh.length - 1].t || 0)) / 2;
    hiccupLine = span <= 90000 ? `One firm patch ${posWord(mid)}, otherwise clean.`
                               : 'A few firm moments scattered through.';
  }

  if (clockLine && hiccupLine)   out.push(`${clockLine} ${hiccupLine}`);
  else if (clockLine)            out.push(clockLine);
  else if (hiccupLine)           out.push(hiccupLine);
  else if (!allHands && eff >= 85) out.push('Clean the whole way.');

  // Optional tail — only when notably off your usual.
  if (ctx && ctx.driveCount > 1 && ctx.avgScore != null){
    const d = (drive.score ?? eff) - ctx.avgScore;
    if (d >= 6)      out.push(pick(['Sharper than your usual.', 'A cut above your average.']));
    else if (d <= -6) out.push(pick(['Off your usual pace.', 'Below your average today.']));
  }

  return out;
}

// The numbers, extracted for a compact facts row beside the narrative. Miles and
// Duration already show in the main stat strip, so this surfaces the *derived*
// context: pace, stops, and (for destination drives) the clock margin + any pit.
export function driveFacts(drive, analysis){
  const facts = [];
  const durMs  = drive.durationMs || 0;
  const miNum  = metersToMiles(drive.distanceMeters || 0);
  const avgMph = analysis.avgSpeedMph || (miNum > 0 && durMs > 0 ? Math.round(miNum / (durMs / 3600000)) : 0);
  const topMph = Math.round(mpsToMph(drive.topSpeedMps || 0));
  facts.push({ label: 'Mi', value: miNum.toFixed(1) });
  facts.push({ label: 'Time', value: fmtDuration(durMs) });
  facts.push({ label: 'Avg', value: String(avgMph), unit: 'mph' });
  facts.push({ label: 'Top', value: String(topMph), unit: 'mph' });
  if (analysis.fullStops != null) facts.push({ label: 'Stops', value: String(analysis.fullStops) });
  if (drive.effectiveness != null && drive.targetEtaSec > 0){
    const targetMs = drive.targetEtaSec * (drive.etaBuffer ?? ETA_BUFFER) * 1000;
    const usedMs   = drive.movingSec != null ? drive.movingSec * 1000 : durMs;
    const diff     = usedMs - targetMs; // + behind, − ahead
    facts.push({ label: diff <= 0 ? 'Ahead' : 'Behind', value: String(Math.max(0, Math.round(Math.abs(diff) / 60000))), unit: 'min' });
    // The two-axis tier grade (S/A/B/…) — the destination-drive payoff.
    const tier = destinationTier(drive.effectiveness, drive.efficiency ?? drive.score);
    if (tier) facts.push({ label: 'Grade', value: tier });
  }
  if ((drive.pitStopMs || 0) > 60000) facts.push({ label: 'Pit', value: String(Math.round(drive.pitStopMs / 60000)), unit: 'min' });
  return facts;
}

export function drivingStyleVerdict(analysis, drive){
  const { score, stopsPerMile } = analysis;
  const topMph = Math.round(mpsToMph(drive.topSpeedMps || 0));
  const isHighway  = topMph > 60;
  const neverStops = stopsPerMile < 0.4;

  if (score >= 93) return { label:'Smooth AF',           sub:'Peak level. Passengers won\'t even notice they\'re moving.' };
  if (score >= 86){
    if (isHighway)   return { label:'Fast & Fluid',       sub:'High speed, zero drama. The highway is yours.' };
    if (neverStops)  return { label:'In The Flow',        sub:'Reading traffic like a pro — you barely had to stop.' };
                     return { label:'Pretty Damn Smooth', sub:'Composed, consistent, controlled. Solid drive.' };
  }
  if (score >= 76){
    if (isHighway)   return { label:'Mostly Smooth',      sub:'Good at speed, a few rough moments slipped through.' };
                     return { label:'Slow & Steady',      sub:'Deliberate driving. A little choppy at times but you stayed patient.' };
  }
  if (score >= 62)   return { label:'Getting There',      sub:'Some smooth patches, some rough ones. The map markers show where to tighten up.' };
  if (score >= 45)   return { label:'Room To Grow',       sub:'Foundation is there. Focus on anticipating stops earlier.' };
                     return { label:'Rough Ride',         sub:'The road had its way today. Study the map markers and find the patterns.' };
}

export function getDriverPersona(drives){
  if (!drives || drives.length < 2) return null;
  const totalMi   = drives.reduce((s,d) => s + metersToMiles(d.distanceMeters||0), 0);
  const avgMi     = totalMi / drives.length;
  const avgScore  = Math.round(drives.reduce((s,d) => s + (d.score||0), 0) / drives.length);
  const avgTop    = drives.reduce((s,d) => s + (d.topSpeedMps||0), 0) / drives.length * 2.237; // mph
  const avgDurMin = drives.reduce((s,d) => s + (d.durationMs||0), 0) / drives.length / 60000;

  // Classify drive type by top speed and trip length
  const hiwayCnt  = drives.filter(d => (d.topSpeedMps||0)*2.237 > 60).length;
  const cityRatio = 1 - hiwayCnt / drives.length;
  const isHighway = hiwayCnt / drives.length > 0.55;
  const isCity    = cityRatio > 0.65;
  const isMixed   = !isHighway && !isCity;
  const isLong    = avgMi > 20;
  const isShort   = avgMi < 5;
  const isSmooth  = avgScore >= 85;
  const isRough   = avgScore < 65;

  const pick = (arr) => arr[drives.length % arr.length];
  let title, subs;

  if (isHighway && isLong && isSmooth){
    title = 'Mile-Eater';
    subs  = [
      `${Math.round(avgMi)} mi avg, highway pace, barely a wobble. You make it look boring — and that's the compliment.`,
      `Clean at speed, clean at distance. ${Math.round(totalMi)} mi logged and the score hasn't flinched.`,
      `You eat interstates for breakfast. Smooth throttle, smooth exits, smooth everything. ${Math.round(avgMi)} mi per run.`,
      `The long haul is your home turf. Consistent enough that your passengers forget they're moving.`,
    ];
  } else if (isHighway && isLong && isRough){
    title = 'Highway Charger';
    subs  = [
      `Long hauls, fast pace, heavy inputs. Back off the throttle 15% and watch the number climb.`,
      `You've got the highway instinct — just needs a softer edge. ${Math.round(totalMi)} mi in, still room to sharpen.`,
      `Speed is there. Smoothness is close. The gap between the two is one gear earlier and one brake later.`,
      `Big miles, big energy. The score wants the same focus, just with a lighter touch.`,
    ];
  } else if (isCity && isShort && isSmooth){
    title = 'Urban Ghost';
    subs  = [
      `Threading city blocks like water. ${Math.round(avgDurMin)} min trips, almost no drama.`,
      `Short runs, surgical lines. Every yellow light read two blocks early. That's the craft.`,
      `You move through traffic like it isn't there. ${drives.length} trips and barely a harsh input to show for it.`,
      `City grid, your rules. Anticipation doing the heavy lifting — brakes barely necessary.`,
    ];
  } else if (isCity && isShort && isRough){
    title = 'Stop-Light Sprinter';
    subs  = [
      `Short hops, hard stops. See the brake lights earlier and the score starts to follow.`,
      `You've got quick reflexes — now use them one beat earlier. That gap is where the score lives.`,
      `City hustle mode. The score wants slower eyes, earlier reads. You've got the instincts — trust them sooner.`,
      `Every stop is a chance to recalibrate. Anticipate the light, not the bumper. It adds up fast.`,
    ];
  } else if (isCity && isSmooth){
    title = 'City Glider';
    subs  = [
      `Reading traffic before it happens. Smooth across ${drives.length} city drives.`,
      `Momentum over muscle — you let the road come to you. The city doesn't rattle you.`,
      `You've dialed in the rhythm. Float between the gaps, scrub speed early, arrive calm. It shows.`,
      `${drives.length} city drives and the inputs stay clean. That takes patience most people skip.`,
    ];
  } else if (isMixed && isSmooth){
    title = 'All-Roads Driver';
    subs  = [
      `Every road type, same composure. Highway, side street, parking lot exit — same smooth energy. That's rare.`,
      `You run it all — morning commute, open road, suburban maze. Nothing catches you off guard. ${Math.round(totalMi)} mi of proof.`,
      `Highways, surface streets — handles both clean. The score doesn't care which road you're on. Neither do you.`,
      `${Math.round(totalMi)} mi across every road type and the score holds. That's not talent, that's calibration.`,
    ];
  } else if (isMixed && !isSmooth){
    title = 'Mixed-Bag Driver';
    subs  = [
      `All kinds of roads, all kinds of inputs. The smooth patches are already in there — string them together.`,
      `Mixed terrain, mixed results. You know what it feels like when it clicks. Chase that on every road.`,
      `Every road type tested, scores still evening out. Consistency is the one unlock between you and a better number.`,
      `The range is there. Pick one habit to clean up — early braking, steady throttle — and watch the floor rise.`,
    ];
  } else if (isHighway){
    title = 'Open Road Cruiser';
    subs  = [
      `Happiest at speed. Avg ${Math.round(avgTop)} mph, ${Math.round(avgMi)} mi per drive. The open road suits you.`,
      `You belong at 75. Wide lanes, easy throttle, letting it breathe. The highway is your natural habitat.`,
      `${Math.round(avgMi)} mi per run at ${Math.round(avgTop)} mph average. Clean lines, no drama. Just road.`,
      `Fast, comfortable, unhurried. There's a version of this score that gets even cleaner — just ease into corners.`,
    ];
  } else {
    title = 'Daily Driver';
    subs  = [
      `${drives.length} drives, ${Math.round(totalMi)} mi, avg score ${avgScore}. The pattern is building.`,
      `${Math.round(totalMi)} miles on the board. Each drive sharpens the picture a little more.`,
      `${drives.length} sessions logged. Score averaging ${avgScore}. The ceiling is higher than this.`,
      `Consistent mileage, consistent effort. ${Math.round(totalMi)} mi in — the data starts talking now.`,
    ];
  }
  return {title, sub: pick(subs), avgScore, drives: drives.length, totalMi: Math.round(totalMi)};
}

// Total milliseconds spent in "pit stops" — stationary runs at least PIT_STOP_MS
// long (gas, coffee, a long errand), which shouldn't count against the clock.
// A normal red light is well under the threshold and is left in. Pure + testable;
// works on absolute- or relative-`t` samples (it only uses time differences).
export function computePitStopMs(samples, opts = {}){
  const pitSpeed = opts.pitSpeed ?? PIT_SPEED_MPS;
  const pitMs    = opts.pitMs    ?? PIT_STOP_MS;
  if (!Array.isArray(samples) || samples.length < 2) return 0;
  let total = 0, runStart = null, prev = null;
  for (const s of samples){
    const stationary = (s.speed || 0) < pitSpeed;
    if (stationary){
      if (runStart == null) runStart = s.t;
    } else if (runStart != null){
      const dur = (prev != null ? prev : s.t) - runStart;
      if (dur >= pitMs) total += dur;
      runStart = null;
    }
    prev = s.t;
  }
  if (runStart != null && prev != null){
    const dur = prev - runStart;
    if (dur >= pitMs) total += dur;
  }
  return total;
}

// The drive time that counts against the clock: wall-clock minus pit stops,
// floored at 0. Both inputs in seconds.
export function movingSeconds(durationSec, pitStopSec){
  return Math.max(0, Math.round(durationSec) - Math.round(pitStopSec || 0));
}

// Momentum series — a smoothness score (0..100) over the course of the drive,
// one point per time bucket. Dips at rough stretches, rises when you're clean.
// The narrative line for the post-drive recap. Pure + testable.
export function momentumSeries(drive, buckets = 48){
  const smp = drive?.samples || [];
  if (smp.length < 4) return [];
  const t0 = smp[0].t, tEnd = smp[smp.length - 1].t;
  const span = (tEnd - t0) || 1;
  const events = (drive.events || []).filter(e => e.type !== 'shift');
  const raw = [];
  for (let b = 0; b < buckets; b++){
    const bs = t0 + span * b / buckets;
    const be = t0 + span * (b + 1) / buckets;
    const seg = smp.filter(s => s.t >= bs && s.t < be);
    if (!seg.length){ raw.push(raw.length ? raw[raw.length - 1] : 90); continue; }
    // Local harshness: p75 of the per-sample peak of |longitudinal|,|lateral|.
    const mags = seg.map(s => Math.max(Math.abs(s.la || 0), Math.abs(s.ra || 0))).sort((a, b) => a - b);
    const p75  = mags[Math.floor(mags.length * 0.75)] || 0;
    let local = 100 - clamp(linMap(p75, 0.4, 4.0, 0, 70), 0, 70);
    for (const e of events){ if (e.t >= bs && e.t < be) local -= (TIER_MULT[e.tier || 2] || 1) * 6; }
    raw.push(clamp(Math.round(local), 0, 100));
  }
  // Light 3-tap smoothing so the line reads as momentum, not noise.
  return raw.map((v, i) => ({
    t: Math.round(span * (i + 0.5) / buckets),
    score: Math.round((raw[Math.max(0, i - 1)] + v + raw[Math.min(raw.length - 1, i + 1)]) / 3),
  }));
}

// Effectiveness (0..100): how the actual drive time compares to the locked ETA.
// On time or faster (after the ETA buffer) = 100; lateness decays linearly.
// Returns null for invalid input. Never rewards beating the ETA further — the
// speed/smoothness trade-off is captured by the separate Efficiency score.
export function effectivenessScore(rawEtaSec, actualSec, buffer = ETA_BUFFER){
  if (!(rawEtaSec > 0) || !(actualSec > 0)) return null;
  const targetSec = rawEtaSec * buffer;
  const overFrac = Math.max(0, (actualSec - targetSec) / targetSec);
  return Math.round(Math.max(0, Math.min(100, 100 - overFrac * PACE_PENALTY)));
}

// Combined shareable tier from the two axes. effectiveness/efficiency are 0..100.
export function destinationTier(effectiveness, efficiency){
  if (effectiveness == null || efficiency == null) return null;
  const timeBand = effectiveness >= 100 ? 0 : effectiveness >= 65 ? 1 : 2; // on-time / close / late
  const effBand  = efficiency   >= 90  ? 0 : efficiency   >= 75 ? 1 : 2;   // high / mid / low smoothness
  const GRID = [
    ['S', 'A', 'B'], // efficiency >= 90
    ['A', 'B', 'C'], // 75..89
    ['B', 'C', 'D'], // < 75
  ];
  return GRID[effBand][timeBand];
}

// Signed clock modifier in points. Positive (beat the ETA) is smoothness-gated so
// only smooth drivers approach the max and can break 100; negative (late) applies
// only when allowPenalty (which ships with the live traffic-aware ETA).
export function clockModifier(rawEtaSec, actualSec, efficiency, allowPenalty = false, buffer = ETA_BUFFER){
  if (!(rawEtaSec > 0) || !(actualSec > 0)) return 0;
  const target = rawEtaSec * buffer;
  const margin = (target - actualSec) / target; // >0 beat it, <0 late
  if (margin >= 0){
    const pace = Math.min(1, margin / CLOCK_BEAT_FULL);
    return CLOCK_MAX_SWING * pace * (clamp(efficiency, 0, 100) / 100);
  }
  if (!allowPenalty) return 0;
  const pace = Math.min(1, (-margin) / CLOCK_LATE_FULL);
  return -CLOCK_MAX_SWING * pace;
}

// Final composite drive score (rounded). Efficiency-only unless the driver
// actually arrived at a destination with a known ETA. Can exceed 100 (rare).
export function compositeScore(efficiency, rawEtaSec, actualSec, { arrived = false, allowPenalty = false, buffer = ETA_BUFFER } = {}){
  const base = clamp(efficiency, 0, 100);
  if (!arrived || !(rawEtaSec > 0) || !(actualSec > 0)) return Math.round(base);
  return Math.round(clamp(base + clockModifier(rawEtaSec, actualSec, base, allowPenalty, buffer), 0, SCORE_MAX));
}
