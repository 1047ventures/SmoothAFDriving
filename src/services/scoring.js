import {
  CFG,
  TIER_MULT,
  CONFIDENCE_PRIOR,
  DIM_WEIGHTS,
  STORAGE_KEY,
  EVENT_COOLDOWN_MS,
  ETA_BUFFER,
  PACE_PENALTY,
} from '../constants.js';
import { clamp, linMap, pct, fmtScore, mpsToMph, metersToMiles } from '../utils/math.js';
import { loadDrives } from './storage.js';
import { detectEventWithThresh } from './sensors/gps.js';

export { detectEventWithThresh };

export function scoreFromEvents(events, cfg, sampleCount){
  cfg = cfg || CFG;
  const basePenalty = { brake: cfg.penaltyBrake, accel: cfg.penaltyAccel, turn: cfg.penaltyTurn };
  let score = 100;
  for (const e of events){
    if (e.type === 'shift') continue;  // informational only, never deduct points
    const base     = basePenalty[e.type] || 3;
    const tier     = TIER_MULT[e.tier || 2] || 1;
    // Road roughness: up to 35% penalty reduction on very rough roads
    const roughAdj = 1 - Math.min(0.35, (e.roadRoughness || 0) / 3.5);
    score -= base * tier * (e.severity || 1) * roughAdj;
  }
  // Confidence weighting: short drives blend toward 100
  if (sampleCount != null && sampleCount > 0){
    score = (sampleCount * score + CONFIDENCE_PRIOR * 100) / (sampleCount + CONFIDENCE_PRIOR);
  }
  return fmtScore(score);
}

// Re-score a stored drive using new CFG (uses pre-computed la/ra per sample)
export function rescoreDrive(drive, cfg){
  const events = [];
  let lastEventT = -Infinity;
  for (const s of drive.samples){
    if ((s.t - lastEventT) < EVENT_COOLDOWN_MS) continue;
    const evt = detectEventWithThresh(s.la || 0, s.ra || 0, cfg, 0, s.speed || 0);
    if (evt){
      events.push({
        ...evt,
        t: s.t, lat: s.lat, lon: s.lon,
        speedMph: Math.round(mpsToMph(s.speed || 0)),
      });
      lastEventT = s.t;
    }
  }
  return {
    ...drive,
    events,
    eventCount: events.length,
    score: scoreFromEvents(events, cfg, drive.samples.length),
  };
}

export function rescoreAllDrives(){
  const all = loadDrives();
  const rescored = all.map(d => rescoreDrive(d, CFG));
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rescored)); } catch {}
  return rescored;
}

export function analyzeDrive(drive){
  const smp = drive.samples || [];
  const n   = smp.length;
  if (n < 3){
    const dims = { peakHarshness:85, throttle:85, steering:85, braking:85, cornering:85, transitions:85, momentum:85 };
    return { score:85, dims, fullStops:0, stopsPerMile:0, longFlipsPerMin:0, latFlipsPerMin:0, p90Harshness:0, stopMarkers:[] };
  }

  const durationMin = (drive.durationMs || 0) / 60000;
  const distanceMi  = metersToMiles(drive.distanceMeters || 0);

  // ── 1. Peak Harshness — p90 of harshness magnitude ───────────────────────
  const hSorted = smp.map(s => s.h || 0).sort((a,b) => a - b);
  const p90H    = pct(hSorted, 90);
  const peakHarshness = Math.round(clamp(linMap(p90H, 0.3, 4.0, 100, 0), 0, 100));

  // ── 2. Throttle Steadiness — rapid longitudinal sign-flip rate ───────────
  const LONG_WIN  = 8;
  const LONG_DEAD = 0.15;
  let longFlips = 0, lastLSign = 0, lastLFlip = -Infinity;
  for (let i = 0; i < n; i++){
    const la = smp[i].la || 0;
    if (Math.abs(la) < LONG_DEAD) continue;
    const sg = la > 0 ? 1 : -1;
    if (lastLSign !== 0 && sg !== lastLSign){
      if (i - lastLFlip <= LONG_WIN) longFlips++;
      lastLFlip = i;
    }
    lastLSign = sg;
  }
  const longFlipsPerMin = durationMin > 0 ? longFlips / durationMin : 0;
  const throttle = Math.round(clamp(linMap(longFlipsPerMin, 0, 8, 100, 0), 0, 100));

  // ── 3. Steering Steadiness — rapid lateral sign-flip rate ────────────────
  const LAT_WIN  = 6;
  const LAT_DEAD = 0.15;
  let latFlips = 0, lastRSign = 0, lastRFlip = -Infinity;
  for (let i = 0; i < n; i++){
    const ra = smp[i].ra || 0;
    if (Math.abs(ra) < LAT_DEAD) continue;
    const sg = ra > 0 ? 1 : -1;
    if (lastRSign !== 0 && sg !== lastRSign){
      if (i - lastRFlip <= LAT_WIN) latFlips++;
      lastRFlip = i;
    }
    lastRSign = sg;
  }
  const latFlipsPerMin = durationMin > 0 ? latFlips / durationMin : 0;
  const steering = Math.round(clamp(linMap(latFlipsPerMin, 0, 10, 100, 0), 0, 100));

  // ── 4. Braking Anticipation — approach quality for each stop ─────────────
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

  // ── 5. Corner Composure — simultaneous braking + lateral force ───────────
  const CORN_LA = -0.5;
  const CORN_RA =  0.8;
  let cornerCount = 0;
  for (const s of smp){
    if ((s.la || 0) < CORN_LA && Math.abs(s.ra || 0) > CORN_RA) cornerCount++;
  }
  const cornerPct = n > 0 ? cornerCount / n : 0;
  const cornering = Math.round(clamp(linMap(cornerPct, 0, 0.08, 100, 0), 0, 100));

  // ── 6. Transition Smoothness — mean jerk magnitude ───────────────────────
  let jerkSum = 0, jerkN = 0;
  for (let i = 1; i < n; i++){
    const dt  = Math.max(0.1, (smp[i].t - smp[i-1].t) / 1000);
    jerkSum  += Math.abs(((smp[i].la || 0) - (smp[i-1].la || 0)) / dt);
    jerkN++;
  }
  const meanJerk  = jerkN > 0 ? jerkSum / jerkN : 0;
  const transitions = Math.round(clamp(linMap(meanJerk, 0.3, 3.0, 100, 0), 0, 100));

  // ── 7. Momentum Management — full stops per mile ─────────────────────────
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
  const momentum = Math.round(clamp(linMap(stopsPerMile, 0, 6, 100, 0), 0, 100));

  // ── Composite ─────────────────────────────────────────────────────────────
  const dims = { peakHarshness, throttle, steering, braking, cornering, transitions, momentum };
  const score = Math.round(
    Object.entries(DIM_WEIGHTS).reduce((s, [k,w]) => s + (dims[k] || 0) * w, 0)
  );

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
  const { dims, stopsPerMile, longFlipsPerMin, latFlipsPerMin, p90Harshness, fullStops } = analysis;
  const cards = [];

  // Worst 2 dimensions below threshold → warning cards
  const ranked = Object.entries(dims).sort((a,b) => a[1] - b[1]);
  let warned = 0;
  for (const [key, score] of ranked){
    if (warned >= 2 || score >= 70) break;
    const texts = {
      peakHarshness: { title: 'Harsh inputs detected',
        body: `Your 90th-percentile harshness was ${p90Harshness.toFixed(2)} m/s² — aim for under 0.8. Feather the brakes and smooth your turn entries.` },
      throttle:      { title: 'Throttle pumping',
        body: `You toggled between gas and brake ~${longFlipsPerMin.toFixed(1)}× per minute. Aim for under 3/min by coasting more and reading stops earlier.` },
      steering:      { title: 'Frequent steering corrections',
        body: `Lateral direction reversed ~${latFlipsPerMin.toFixed(1)}× per minute. Look further ahead — your hands follow your eyes.` },
      braking:       { title: 'Late braking',
        body: `Stops came with short approach distances and sharp decel. Spot brake zones earlier and ease in gradually over a longer runway.` },
      cornering:     { title: 'Braking mid-corner',
        body: `Simultaneous braking and lateral force hurts balance. Brake before the apex, not through it.` },
      transitions:   { title: 'Jerky pedal transitions',
        body: `High jerk between pedal phases — blend smoothly between braking, coasting, and acceleration.` },
      momentum:      { title: `${fullStops} full stop${fullStops !== 1 ? 's' : ''}`,
        body: `${stopsPerMile.toFixed(1)} stops/mile. Read lights and traffic to maintain a rolling pace — the goal is to never fully stop.` },
    };
    if (texts[key]){ cards.push({ type: 'warning', ...texts[key] }); warned++; }
  }

  // Best dimension ≥ 80 → positive card
  const [bestKey, bestScore] = ranked[ranked.length - 1];
  if (bestScore >= 80){
    const praise = {
      peakHarshness: { title: 'Impressively smooth inputs',
        body: `Your 90th-percentile harshness was just ${p90Harshness.toFixed(2)} m/s². Passengers felt barely a ripple.` },
      throttle:      { title: 'Steady throttle control',
        body: `Only ${longFlipsPerMin.toFixed(1)} throttle reversals per minute — smooth progressive pedal work.` },
      steering:      { title: 'Committed steering lines',
        body: `Lateral corrections at just ${latFlipsPerMin.toFixed(1)}/min — you tracked your intended path confidently.` },
      braking:       { title: 'Excellent braking anticipation',
        body: `Long, gentle approaches to every stop — exactly what the car and your passengers want.` },
      cornering:     { title: 'Clean corner exits',
        body: `Minimal braking-while-cornering. Textbook corner entry technique.` },
      transitions:   { title: 'Silky pedal transitions',
        body: `Very low jerk between phases. Passengers won't even reach for the grab handle.` },
      momentum:      { title: 'Excellent momentum management',
        body: `Only ${fullStops} full stop${fullStops !== 1 ? 's' : ''} (${stopsPerMile.toFixed(1)}/mile). You read the road and kept rolling.` },
    };
    if (praise[bestKey]) cards.push({ type: 'positive', ...praise[bestKey] });
  }

  if (!cards.length)
    cards.push({ type: 'positive', title: 'Smooth AF', body: 'Strong across all seven dimensions. Your passengers felt the difference.' });

  return cards;
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

// Effectiveness (0..100): how the actual drive time compares to the locked ETA.
// On time or faster (after the ETA buffer) = 100; lateness decays linearly.
// Returns null for invalid input. Never rewards beating the ETA further — the
// speed/smoothness trade-off is captured by the separate Efficiency score.
export function effectivenessScore(rawEtaSec, actualSec){
  if (!(rawEtaSec > 0) || !(actualSec > 0)) return null;
  const targetSec = rawEtaSec * ETA_BUFFER;
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
