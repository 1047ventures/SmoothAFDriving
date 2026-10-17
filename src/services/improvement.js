/**
 * "Are you getting better?" — the North Star, answered in one line.
 *
 * Compares your most recent drives against the ones before them across the
 * measures a driver can actually change, and picks the single strongest real
 * change to say out loud. Pure: drives in (newest-first, as stored), verdict out.
 *
 * Why drive counts, not calendar days: people drive in bursts. "Last 30 days"
 * is empty after a vacation and swamped after a road trip; "your last 5 drives
 * vs the 10 before" always compares like with like.
 *
 * Rates are pooled (total events / total miles), never averaged per drive — a
 * 0.4-mile hop with one hard brake would otherwise read as 2.5/mi and swamp a
 * clean 30-mile run.
 */
import { metersToMiles } from '../utils/math.js';
import { MIN_DRIVE_MILES } from '../constants.js';
import { smoothMiles } from './points.js';

export const RECENT_N   = 5;
export const BASELINE_N = 10;
export const MIN_EACH   = 3;   // need at least this many drives on each side

const miles = d => metersToMiles(d.distanceMeters || 0);

// Event detection changed on 2026-10-15 (iOS moved to native Core Motion; before
// that a failed calibration fell back to 1 Hz GPS detection at a different event
// rate). Comparing event rates across that line would credit the driver for an
// app change, so event measures only use drives from this era on.
export const EVENT_ERA_START = Date.parse('2026-10-16T00:24:18Z');

// Drives still carrying their GPS track were scored (or rescored) by the current
// engine and walked for smooth miles. Track-less drives (cloud-restored, or
// stripped under storage quota) hold numbers from older engines or estimates —
// mixing them in would measure the app, not the driver.
const hasTrack = d => Array.isArray(d.samples) && d.samples.length >= 2;
const mean  = a => a.reduce((x, y) => x + y, 0) / a.length;
const f1    = x => x.toFixed(1);

// Events are only trustworthy when the drive still carries them. A cloud-restored
// drive has eventCount but an empty events array — counting it as zero brakes
// would invent a perfect drive.
const hasEvents = d => (d.startTime || 0) >= EVENT_ERA_START
  && Array.isArray(d.events) && (d.events.length > 0 || !(d.eventCount > 0));

function eventRate(type){
  return drives => {
    const ok = drives.filter(hasEvents);
    const mi = ok.reduce((s, d) => s + miles(d), 0);
    if (ok.length < MIN_EACH || mi < MIN_RATE_MILES) return null;
    // Tier 1 is a mild nudge, not a hard event — only tier 2+ counts.
    const n = ok.reduce((s, d) => s + d.events.filter(e => e?.type === type && (e.tier ?? 2) >= 2).length, 0);
    return { rate: (n / mi) * 10, n };   // per 10 miles — reads better than 0.3/mi
  };
}

const MIN_RATE_MILES = 10;   // miles needed on each side before a rate means anything
const MIN_BASE_EVENTS = 3;   // a baseline of 1 brake can only ever go "down 100%"

function dimMean(key){
  return drives => {
    const v = drives.filter(hasTrack).map(d => d.dims?.[key]).filter(x => typeof x === 'number');
    return v.length >= MIN_EACH ? mean(v) : null;
  };
}

/**
 * The measures. `kind` decides how a change is judged:
 *  - 'rate'  (lower is better): relative change, needs ≥ 20% to count
 *  - 'score' (0..100, higher is better): absolute change, needs ≥ 3 points
 * `better`/`worse` turn a size into words.
 */
export const MEASURES = [
  {
    key: 'braking', kind: 'rate', trend: 'braking',
    value: eventRate('brake'),
    better: (p, r, b) => `Hard brakes down to ${f1(r)} per 10 mi, from ${f1(b)}`,
    worse:  (p, r, b) => `Hard brakes up to ${f1(r)} per 10 mi, from ${f1(b)}`,
    tip: 'Spot stops earlier and ease in over a longer runway.',
  },
  {
    key: 'accel', kind: 'rate', trend: 'accel',
    value: eventRate('accel'),
    better: (p, r, b) => `Hard launches down to ${f1(r)} per 10 mi, from ${f1(b)}`,
    worse:  (p, r, b) => `Hard launches up to ${f1(r)} per 10 mi, from ${f1(b)}`,
    tip: 'Squeeze the throttle — let the car build speed for you.',
  },
  {
    key: 'turns', kind: 'rate', trend: 'turns',
    value: eventRate('turn'),
    better: (p, r, b) => `Sharp turns down to ${f1(r)} per 10 mi, from ${f1(b)}`,
    worse:  (p, r, b) => `Sharp turns up to ${f1(r)} per 10 mi, from ${f1(b)}`,
    tip: 'Slow before the corner, not in it.',
  },
  {
    key: 'smoothRate', kind: 'score', trend: null,
    value: drives => {
      const ok = drives.filter(d => hasTrack(d) || d.points);
      const tot = ok.reduce((s, d) => s + miles(d), 0);
      if (ok.length < MIN_EACH || tot < MIN_RATE_MILES) return null;
      const sm = ok.reduce((s, d) => s + (d.points?.smoothMi ?? smoothMiles(d).smoothMi), 0);
      return (sm / tot) * 100;
    },
    better: (p, r, b) => `${Math.round(r)}% of your miles smooth, up from ${Math.round(b)}%`,
    worse:  (p, r, b) => `${Math.round(r)}% of your miles smooth, down from ${Math.round(b)}%`,
    tip: 'Pick one habit — braking or launches — and work it for a week.',
  },
  {
    key: 'smoothness', kind: 'score', trend: null,
    value: dimMean('smoothness'),
    better: p => `Pedal smoothness up ${p} points`,
    worse:  p => `Pedal smoothness down ${p} points`,
    tip: 'Feather both pedals and blend between them.',
  },
  {
    key: 'score', kind: 'score', trend: 'score',
    value: drives => {
      // Efficiency = smoothness alone (no ETA clock), current engine only.
      const v = drives.filter(hasTrack).map(d => d.efficiency).filter(x => typeof x === 'number');
      return v.length >= MIN_EACH ? mean(v) : null;
    },
    better: p => `Score up ${p} points`,
    worse:  p => `Score down ${p} points`,
    tip: 'Smooth first — the number follows.',
  },
];

const RATE_MIN  = 0.20;  // 20% relative change in a per-mile rate
const SCORE_MIN = 3;     // 3 points on a 0..100 measure

/** Judge one measure. Returns null when there's nothing honest to say. */
export function compareMeasure(m, recent, baseline){
  let r = m.value(recent), b = m.value(baseline);
  if (r == null || b == null) return null;
  if (m.kind === 'rate'){
    if (b.n < MIN_BASE_EVENTS) return null;       // too few events to improve from
    r = r.rate; b = b.rate;
    const rel = (b - r) / b;                       // + = fewer events = better
    const pct = Math.round(Math.abs(rel) * 100);
    if (Math.abs(rel) < RATE_MIN) return { key: m.key, dir: 'steady', strength: 0, recent: r, baseline: b };
    const dir = rel > 0 ? 'better' : 'worse';
    return { key: m.key, dir, strength: Math.abs(rel) / RATE_MIN, recent: r, baseline: b,
             text: dir === 'better' ? m.better(pct, r, b) : m.worse(pct, r, b), tip: m.tip, trend: m.trend };
  }
  const delta = r - b;
  const pts = Math.round(Math.abs(delta));
  if (Math.abs(delta) < SCORE_MIN) return { key: m.key, dir: 'steady', strength: 0, recent: r, baseline: b };
  const dir = delta > 0 ? 'better' : 'worse';
  return { key: m.key, dir, strength: Math.abs(delta) / SCORE_MIN, recent: r, baseline: b,
           text: dir === 'better' ? m.better(pts, r, b) : m.worse(pts, r, b), tip: m.tip, trend: m.trend };
}

/** Drives that count: scored, real, long enough to say something. */
export function eligibleDrives(drives){
  return (drives || []).filter(d =>
    d && d.score != null && !d.simulated && miles(d) >= MIN_DRIVE_MILES);
}

/**
 * The verdict.
 * status: 'not-enough' | 'improving' | 'slipping' | 'steady'
 * headline: the one line to show; detail: what it's compared against.
 */
export function improvementVerdict(drives){
  const all = eligibleDrives(drives);
  if (all.length < MIN_EACH * 2){
    const need = MIN_EACH * 2 - all.length;
    return { status: 'not-enough', need,
             headline: `${need} more drive${need === 1 ? '' : 's'}`,
             detail: 'and we’ll show if you’re getting smoother.' };
  }
  const recentN = Math.min(RECENT_N, Math.floor(all.length / 2));
  const recent = all.slice(0, recentN);
  const baseline = all.slice(recentN, recentN + BASELINE_N);
  const results = MEASURES.map(m => compareMeasure(m, recent, baseline)).filter(Boolean);

  const vs = `over your last ${recent.length} drives`;
  const best  = results.filter(r => r.dir === 'better').sort((a, b) => b.strength - a.strength)[0];
  const worst = results.filter(r => r.dir === 'worse').sort((a, b) => b.strength - a.strength)[0];

  // Lead with progress whenever there is any — it's the point of the app — and
  // only lead with a slip when nothing improved.
  if (best) return { status: 'improving', headline: best.text, detail: vs, measure: best.key, trend: best.trend, results };
  if (worst) return { status: 'slipping', headline: worst.text, detail: vs, tip: worst.tip, measure: worst.key, trend: worst.trend, results };
  return { status: 'steady', headline: 'Holding steady', detail: vs, results };
}
