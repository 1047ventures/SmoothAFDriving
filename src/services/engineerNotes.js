// Engineer's notes — the recap's coaching, written the way a race engineer
// talks: what happened, where, and what to do next time. Every note is tied to
// one real moment of the drive (its time and position), never a generic tip.
//
// Up to two "fix" notes from the worst harsh events (one per kind, so three hard
// brakes read as one note that says so), then one "praise" note from the
// smoothest stretch. When map features are known, a brake is explained by what
// was ahead of the car: a light, a stop sign, or nothing — which means traffic.
// Pure — no DOM, no network; the recap passes the features in once fetched.
import { fmtDuration } from '../utils/math.js';
import { classifyStop, headingBefore } from './signals.js';
import { TRAFFIC_MIN_RATIO } from '../constants.js';

const NAMES = {
  brake: ['Hard brake', 'Extreme brake'],
  accel: ['Hard accel', 'Extreme accel'],
  turn:  ['Sharp turn', 'Extreme turn'],
};

export function eventName(e){
  const n = NAMES[e.type];
  return n ? n[(e.tier || 2) >= 4 ? 1 : 0] : 'Harsh input';
}

// Direction of travel just before time t (samples carry drive-relative t).
function headingAt(samples, t){
  if (!samples?.length || t == null) return null;
  let idx = samples.findIndex(s => s.t >= t);
  if (idx < 0) idx = samples.length - 1;
  return headingBefore(samples, idx);
}

// What to do next time, given what the road had ahead of you.
function advice(e, cause){
  if (e.type === 'accel') return 'Roll into the throttle instead of stabbing it. Squeeze for a count of two.';
  if (e.type === 'turn')  return 'Take the speed off before the turn, then hold steady through it.';
  switch (cause?.kind){
    case 'light': return 'There was a light ahead. Lift off earlier and let the car roll up to it.';
    case 'queue': return `There was a light ${cause.distM} m ahead with a queue. Come off the gas sooner and coast into the line.`;
    case 'sign':  return 'There was a stop sign ahead. Start slowing a beat earlier.';
    case 'other': return 'No light or sign there, so it was traffic. Leave a bigger gap and you can coast instead of brake.';
    default:      return 'Look further up the road and come off the gas sooner.';
  }
}

/**
 * drive:    the stored drive (events, samples, distanceMeters, traffic)
 * analysis: analyzeDrive output (smoothStreakMi)
 * features: map features near the events ([{lat,lon,kind}]) or null if unknown
 * Returns [{ tone: 'fix'|'praise', title, body, lat, lon, t }] — at most 3.
 */
export function engineerNotes(drive, analysis, features = null){
  const notes = [];
  const events = (drive.events || []).filter(e => NAMES[e.type]);
  const heavy  = (drive.traffic?.ratio || 0) >= TRAFFIC_MIN_RATIO;

  // Worst event of each kind, worst kinds first.
  const byType = {};
  for (const e of events) (byType[e.type] ||= []).push(e);
  const worstPerType = Object.values(byType)
    .map(list => ({ worst: list.reduce((a, b) => (b.severity || 0) > (a.severity || 0) ? b : a), count: list.length }))
    .sort((a, b) => (b.worst.severity || 0) - (a.worst.severity || 0))
    .slice(0, 2);

  for (const { worst: e, count } of worstPerType){
    const cause = (features && e.type === 'brake' && e.lat != null)
      ? classifyStop({ lat: e.lat, lon: e.lon }, headingAt(drive.samples, e.t), features)
      : null;
    const kind = eventName(e).split(' ')[1] + 's';  // "brakes" / "accels" / "turns"
    const more = count > 1 ? ` That was 1 of ${count} hard ${kind} this drive.` : '';
    notes.push({
      tone: 'fix',
      title: `${eventName(e)} · ${fmtDuration(e.t || 0)} in · ${e.speedMph || 0} mph`,
      body: advice(e, cause) + more,
      lat: e.lat ?? null, lon: e.lon ?? null, t: e.t ?? null,
    });
  }

  const streak = analysis?.smoothStreakMi;
  const distMi = (drive.distanceMeters || 0) / 1609.344;
  if (!events.length){
    notes.push({ tone: 'praise', title: 'Clean the whole way',
      body: heavy ? 'Not a single harsh input, in heavy traffic. That is the job.' : 'Not a single harsh input. That rhythm is the target.' });
  } else if (streak != null && streak >= 0.3){
    notes.push({ tone: 'praise', title: `${streak.toFixed(1)} mi with zero harsh inputs`,
      body: (heavy ? 'Your smoothest stretch, in heavy traffic.' : 'Your smoothest stretch of the drive.') +
        (distMi > 0 && streak >= distMi * 0.5 ? ' Most of the trip was this clean.' : ' Drive the rest like that.') });
  }
  return notes;
}
