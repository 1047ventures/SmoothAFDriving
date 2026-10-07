/**
 * Live driving insights — what the driving screen can say about the drive so far.
 *
 * The score is the goal, but a number that only ever says "85" gives you nothing to
 * play with. These are the things that track the philosophy of the app — the fewest,
 * smoothest inputs, the fewest full stops, the longest clean line:
 *
 *   · CLEAN STREAK  distance since your last harsh input, against your personal best
 *   · ROLLED IT     slowed to a crawl for a light and kept moving — no full stop
 *   · SMOOTH STOP   a full stop you eased into
 *   · MILESTONES    0.5 / 1 / 2 / … miles clean, and a new best
 *   · HARSH INPUT   a hard brake / launch / turn, and the streak it cost
 *
 * Everything here is pure (samples in, facts out) so each rule is unit-tested. The
 * screen (ui/hud.js) only draws what this returns, and shows at most ONE message at a
 * time via the feed below — the screen stays quiet unless there is something to say.
 */
import { haversine } from '../utils/math.js';

const M_PER_MI = 1609.34;

export const LIVE = {
  CRUISE_MPS: 6,          // ~13 mph: you're travelling
  CRUISE_PEAK_MPS: 8,     // had to have been going this fast before slowing counts as an approach
  SLOW_MPS: 4.5,          // below this, from cruise, you're slowing for something
  ROLL_MAX_MPS: 3.6,      // ~8 mph: a dip this low that never stopped = "rolled it"
  STOP_MPS: 0.5,          // a full stop (same as scoring)
  STOP_MS: 1500,          // …held this long (same as scoring)
  SMOOTH_STOP_MIN_S: 5,   // eased in over at least this long…
  SMOOTH_STOP_MAX_DECEL: 1.8,   // …without ever braking harder than this (m/s²)
  MILESTONES_MI: [0.5, 1, 2, 3, 5, 10, 20],
  MIN_LOST_MI: 0.25,      // only mention "lost a streak" if it was worth mentioning
};

const laOf = s => (s.longAccel ?? s.la ?? 0);
export const isHarsh = e => Boolean(e) && e.type !== 'shift' && (e.tier || 2) >= 2;

/** Longest clean stretch of the drive, in miles: the biggest gap between harsh inputs. */
export function longestCleanStreakMi(samples, events){
  if (!samples || samples.length < 2) return 0;
  const cuts = (events || []).filter(isHarsh).map(e => e.t).sort((a, b) => a - b);
  let best = 0, run = 0, ci = 0;
  for (let i = 1; i < samples.length; i++){
    while (ci < cuts.length && cuts[ci] <= samples[i].t){ best = Math.max(best, run); run = 0; ci++; }
    run += haversine(samples[i - 1], samples[i]);
  }
  return Math.max(best, run) / M_PER_MI;
}

const fmtMiles = (mi) => `${mi.toFixed(1)} mi`;

/**
 * Incremental tracker: feed it the growing samples/events arrays on every tick; it only
 * looks at what's new. `bestMi` is the driver's personal best before this drive.
 */
export function createLiveInsights({ bestMi = 0 } = {}){
  let n = 0;                  // samples consumed
  let eventsSeen = 0;
  let streakM = 0;
  let bestM = bestMi * M_PER_MI;
  let milestoneIdx = 0;       // next milestone to announce for the CURRENT streak
  let announcedBest = false;

  // approach / stop state machine
  let phase = 'start';        // start | cruise | slowing | stopped
  let peak = 0, lastCruiseT = 0;
  let minSpeed = Infinity, decelPeak = 0, stopSince = null, hadFullStop = false;
  let rolled = 0;             // times you rolled through without a full stop this drive

  function onSample(s, out){
    const v = s.speed || 0, t = s.t, la = laOf(s);

    if (phase === 'start' || phase === 'stopped'){
      if (v > LIVE.CRUISE_MPS){ phase = 'cruise'; peak = v; lastCruiseT = t; }
      return;
    }
    if (phase === 'cruise'){
      if (v >= peak * 0.9){ lastCruiseT = t; }
      peak = Math.max(peak * 0.995, v);                 // let the peak decay slowly so old fast stretches fade
      if (v < LIVE.SLOW_MPS && peak >= LIVE.CRUISE_PEAK_MPS){
        phase = 'slowing'; minSpeed = v; decelPeak = Math.max(0, -la); stopSince = null; hadFullStop = false;
      }
      return;
    }
    if (phase === 'slowing'){
      minSpeed = Math.min(minSpeed, v);
      decelPeak = Math.max(decelPeak, -la);
      if (v < LIVE.STOP_MPS){
        if (stopSince == null) stopSince = t;
        if (t - stopSince >= LIVE.STOP_MS && !hadFullStop){
          hadFullStop = true; phase = 'stopped';
          const easedS = Math.round((stopSince - lastCruiseT) / 1000);
          if (easedS >= LIVE.SMOOTH_STOP_MIN_S && decelPeak <= LIVE.SMOOTH_STOP_MAX_DECEL){
            out.push({ kind: 'smooth-stop', tone: 'good', priority: 3, text: `Smooth stop — eased in over ${easedS}s.` });
          }
        }
      } else {
        stopSince = null;
      }
      if (v > LIVE.CRUISE_MPS){
        if (!hadFullStop && minSpeed <= LIVE.ROLL_MAX_MPS){
          rolled++;
          out.push({ kind: 'rolled', tone: 'good', priority: 4, text: 'Rolled it — no stop.' });
        }
        phase = 'cruise'; peak = v; lastCruiseT = t;
      }
    }
  }

  return {
    get bestMi(){ return bestM / M_PER_MI; },
    get rolled(){ return rolled; },

    /** Returns { streakMi, bestMi, isNewBest, insights[] } for everything new since last call. */
    update(samples, events){
      const out = [];
      samples = samples || []; events = events || [];

      // New harsh events first — they reset the streak.
      for (; eventsSeen < events.length; eventsSeen++){
        const e = events[eventsSeen];
        if (!isHarsh(e)) continue;
        const lostMi = streakM / M_PER_MI;
        // Distance already travelled since the event time (events land on the sample that detected them).
        let since = 0;
        for (let i = samples.length - 1; i > 0 && samples[i].t > e.t; i--) since += haversine(samples[i - 1], samples[i]);
        streakM = since; milestoneIdx = 0; announcedBest = false;
        const what = e.type === 'brake' ? 'Hard brake' : e.type === 'accel' ? 'Hard launch' : 'Sharp turn';
        out.push({
          kind: 'harsh', tone: 'bad', priority: 5,
          text: lostMi >= LIVE.MIN_LOST_MI ? `${what} — lost a ${fmtMiles(lostMi)} streak.` : `${what}.`,
        });
      }

      for (; n < samples.length; n++){
        const s = samples[n];
        if (n > 0) streakM += haversine(samples[n - 1], s);
        onSample(s, out);
      }

      // Milestones / new best for the current streak.
      const streakMi = streakM / M_PER_MI;
      while (milestoneIdx < LIVE.MILESTONES_MI.length && streakMi >= LIVE.MILESTONES_MI[milestoneIdx]){
        const m = LIVE.MILESTONES_MI[milestoneIdx++];
        out.push({ kind: 'milestone', tone: 'good', priority: 2, text: m === 1 ? '1 mile clean.' : `${m} ${m < 1 ? 'mi' : 'miles'} clean.` });
      }
      let isNewBest = false;
      if (streakM > bestM){
        // A personal best only means something once there's a real one to beat.
        if (bestM >= 0.5 * M_PER_MI && !announcedBest){
          announcedBest = true;
          out.push({ kind: 'best', tone: 'good', priority: 5, text: `New best streak — ${fmtMiles(streakMi)}.` });
        }
        bestM = streakM; isNewBest = true;
      }
      return { streakMi, bestMi: bestM / M_PER_MI, isNewBest, insights: out };
    },
  };
}

/**
 * Shows at most one message at a time, and rarely. Good news waits its turn (min gap); a
 * harsh input is shown straight away. Stale queued messages are dropped rather than shown late.
 */
export function createInsightFeed({ minGapMs = 7000, showMs = 4500, staleMs = 15000, maxQueue = 2 } = {}){
  let queue = [], cur = null, curSince = 0, lastShown = -Infinity;
  return {
    push(ins, now){
      queue.push({ ...ins, at: now });
      queue.sort((a, b) => b.priority - a.priority || a.at - b.at);
      queue = queue.slice(0, maxQueue);
    },
    current(now){
      if (cur && now - curSince >= showMs) cur = null;
      queue = queue.filter(q => now - q.at <= staleMs);
      const next = queue[0];
      if (next){
        const urgent = next.tone === 'bad';
        const canShow = !cur ? (urgent || now - lastShown >= minGapMs) : (urgent && cur.tone !== 'bad');
        if (canShow){ cur = queue.shift(); curSince = now; lastShown = now; }
      }
      return cur;
    },
    clear(){ queue = []; cur = null; },
  };
}

/**
 * The last `windowMs` of the drive as a compact series for the inputs ribbon:
 * [{ x: 0..1 (0 = oldest, 1 = now), la, speed, t }], thinned to at most `maxPts`.
 */
export function ribbonSeries(samples, nowMs, windowMs = 90000, maxPts = 90){
  if (!samples || !samples.length) return [];
  const from = nowMs - windowMs;
  let i = samples.length;
  while (i > 0 && samples[i - 1].t >= from) i--;
  const win = samples.slice(i);
  const step = Math.max(1, Math.ceil(win.length / maxPts));
  const out = [];
  for (let k = 0; k < win.length; k += step){
    const s = win[k];
    out.push({ x: Math.min(1, Math.max(0, (s.t - from) / windowMs)), la: laOf(s), speed: s.speed || 0, t: s.t });
  }
  const last = win[win.length - 1];
  if (out.length && out[out.length - 1].t !== last.t) out.push({ x: Math.min(1, Math.max(0, (last.t - from) / windowMs)), la: laOf(last), speed: last.speed || 0, t: last.t });
  return out;
}
