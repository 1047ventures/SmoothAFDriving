/**
 * Per-drive trend series.
 *
 * The home sparkline drew a line and then refused to explain it. This is what
 * it opens into: the same shape, but for a metric you chose, with the numbers
 * attached.
 *
 * Everything here is pure — drives in, series out — because a trend that is
 * subtly wrong is invisible. A miscounted harsh brake looks exactly like a
 * correctly counted one.
 *
 * Ordering note: drives are stored newest-first, but a trend reads left-to-right
 * as time moving forward. Every series is reversed before it is returned, and
 * that happens in ONE place so a chart can never disagree with its own summary.
 */

import { metersToMiles } from '../utils/math.js';

/** How many drives a trend looks back over. */
export const TREND_WINDOW = 30;

const countEvents = (drive, type) =>
  (drive?.events || []).filter(e => e?.type === type).length;

/**
 * The metrics a driver can actually act on.
 *
 * `lowerIsBetter` isn't decoration — it decides which direction of travel gets
 * called an improvement, and getting it backwards would congratulate someone for
 * braking harder.
 */
export const METRICS = {
  score: {
    label: 'Score', unit: '', lowerIsBetter: false,
    value: d => (typeof d?.score === 'number' ? Math.round(d.score) : null),
  },
  miles: {
    label: 'Miles', unit: 'mi', lowerIsBetter: false, decimals: 1,
    value: d => (typeof d?.distanceMeters === 'number' ? metersToMiles(d.distanceMeters) : null),
  },
  braking: {
    label: 'Hard braking', unit: '', lowerIsBetter: true,
    value: d => countEvents(d, 'brake'),
  },
  accel: {
    label: 'Hard acceleration', unit: '', lowerIsBetter: true,
    value: d => countEvents(d, 'accel'),
  },
  turns: {
    label: 'Sharp turns', unit: '', lowerIsBetter: true,
    value: d => countEvents(d, 'turn'),
  },
  stops: {
    label: 'Full stops', unit: '', lowerIsBetter: true,
    // Stop-and-go traffic isn't a driving fault, so this is context rather than
    // a score: it explains a low momentum reading instead of blaming anyone.
    value: d => (typeof d?.fullStops === 'number' ? d.fullStops : null),
  },
};

/**
 * Build one metric's series from the drive history.
 *
 * Drives with no value for the metric are dropped rather than plotted as zero —
 * a drive recovered without samples has no stop count, and drawing that as 0
 * invents a perfect drive that never happened.
 */
export function buildSeries(drives, metricKey, window = TREND_WINDOW){
  const metric = METRICS[metricKey];
  if (!metric) return null;

  const points = (drives || [])
    .slice(0, window)                    // newest-first, so take from the front
    .map(d => ({ value: metric.value(d), ts: d?.ts || d?.startTime || 0 }))
    .filter(p => typeof p.value === 'number' && Number.isFinite(p.value))
    .reverse();                          // ...then flip so time runs left→right

  if (!points.length) return { metric: metricKey, label: metric.label, points: [], summary: null };

  const values = points.map(p => p.value);
  const sum    = values.reduce((a, b) => a + b, 0);

  return {
    metric:  metricKey,
    label:   metric.label,
    unit:    metric.unit,
    points,
    summary: {
      count:   values.length,
      average: sum / values.length,
      best:    metric.lowerIsBetter ? Math.min(...values) : Math.max(...values),
      latest:  values[values.length - 1],
      trend:   trendDirection(values, metric.lowerIsBetter),
    },
  };
}

/**
 * Is this getting better or worse?
 *
 * Compares the recent half against the earlier half rather than first-vs-last:
 * one atypical drive at either end would otherwise flip the verdict, and a
 * driver told they are backsliding because of a single trip to the tip will
 * stop believing the app.
 *
 * Needs at least four drives to say anything. Below that it returns 'flat',
 * because two points is a line, not a trend.
 */
export function trendDirection(values, lowerIsBetter = false){
  if (!values || values.length < 4) return 'flat';

  const mid    = Math.floor(values.length / 2);
  const older  = values.slice(0, mid);
  const recent = values.slice(mid);
  const mean   = a => a.reduce((x, y) => x + y, 0) / a.length;

  const delta = mean(recent) - mean(older);
  const scale = Math.abs(mean(older)) || 1;

  // Under 5% is noise. Calling that an improvement would make the indicator
  // move constantly and mean nothing.
  if (Math.abs(delta) / scale < 0.05) return 'flat';

  const rising = delta > 0;
  return (rising !== lowerIsBetter) ? 'improving' : 'worsening';
}

/**
 * Map a series to SVG polyline points.
 *
 * Kept separate from rendering so it can be tested without a DOM, and so the
 * chart and any future export share one geometry.
 */
export function toPolyline(series, width, height, pad = 4){
  const pts = series?.points || [];
  if (!pts.length) return '';

  const values = pts.map(p => p.value);
  const min    = Math.min(...values);
  const max    = Math.max(...values);
  const span   = max - min;

  const innerW = width  - pad * 2;
  const innerH = height - pad * 2;

  return pts.map((p, i) => {
    const x = pad + (pts.length === 1 ? innerW / 2 : (i / (pts.length - 1)) * innerW);
    // A flat series has no span to scale against; centre it rather than
    // dividing by zero and printing NaN into the DOM.
    const y = pad + (span === 0 ? innerH / 2 : innerH - ((p.value - min) / span) * innerH);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}
