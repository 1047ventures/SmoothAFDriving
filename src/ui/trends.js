/**
 * Driving Trends screen.
 *
 * The home sparkline drew a line and refused to explain it; this is what it
 * opens into. All the maths lives in services/trends.js (pure, tested) — this
 * file only turns a chosen metric into chart geometry and a summary, and lets
 * you switch which metric you're looking at.
 */

import { METRICS, buildSeries, toPolyline } from '../services/trends.js';
import { loadDrives } from '../services/storage.js';
import { showScreen } from './router.js';

// Order the chips are shown in — the two headline metrics first, then the
// harsh-event counts you're trying to drive down.
const METRIC_ORDER = ['score', 'miles', 'braking', 'accel', 'turns', 'stops'];
const CHART_W = 320, CHART_H = 150, PAD = 12;

let active = 'score';

const el = id => document.getElementById(id);

/** Format a metric value with its unit and decimals. */
function fmt(metricKey, value){
  if (value == null || !Number.isFinite(value)) return '—';
  const m = METRICS[metricKey];
  const n = m.decimals ? value.toFixed(m.decimals) : Math.round(value).toString();
  return m.unit ? `${n} ${m.unit}` : n;
}

const TREND_COPY = {
  improving: { word: 'Improving', cls: 'up',   arrow: '↗' },
  worsening: { word: 'Slipping',  cls: 'down', arrow: '↘' },
  flat:      { word: 'Steady',    cls: 'flat', arrow: '→' },
};

function renderChips(){
  const wrap = el('trends-metrics');
  if (!wrap) return;
  wrap.innerHTML = METRIC_ORDER.map(key => `
    <button class="trends-chip${key === active ? ' on' : ''}" type="button" role="tab"
            aria-selected="${key === active}" data-metric="${key}">${METRICS[key].label}</button>`).join('');
}

/** Draw the chart + summary for the active metric. */
function renderChart(drives){
  const series = buildSeries(drives, active);
  const pts = series?.points || [];

  el('trends-metric-name').textContent = METRICS[active].label;
  el('trends-window').textContent = pts.length ? `last ${pts.length} drive${pts.length === 1 ? '' : 's'}` : '';

  const chart = el('trends-chart');
  const empty = el('trends-empty');
  const trendEl = el('trends-trend');

  // A single point isn't a trend — draw nothing and say so, rather than a lone
  // dot that reads as a broken chart.
  if (pts.length < 2){
    chart.style.visibility = 'hidden';
    empty.hidden = false;
    trendEl.textContent = '';
    el('trends-avg').textContent = el('trends-best').textContent = el('trends-latest').textContent = '—';
    return;
  }
  chart.style.visibility = 'visible';
  empty.hidden = true;

  const line = toPolyline(series, CHART_W, CHART_H, PAD);
  el('trends-line').setAttribute('points', line);

  // Close the area down to the baseline under the line.
  const [firstX] = line.split(' ')[0].split(',');
  const lastPt = line.split(' ').at(-1);
  const [lastX] = lastPt.split(',');
  el('trends-area').setAttribute('points',
    `${firstX},${CHART_H - PAD} ${line} ${lastX},${CHART_H - PAD}`);

  // Emphasised endpoint — where you are now.
  const [dx, dy] = lastPt.split(',');
  const dot = el('trends-dot');
  dot.setAttribute('cx', dx); dot.setAttribute('cy', dy); dot.setAttribute('r', '4');

  const s = series.summary;
  el('trends-avg').textContent    = fmt(active, s.average);
  el('trends-best').textContent   = fmt(active, s.best);
  el('trends-latest').textContent = fmt(active, s.latest);

  const t = TREND_COPY[s.trend] || TREND_COPY.flat;
  trendEl.className = `trends-trend ${t.cls}`;
  trendEl.textContent = `${t.arrow} ${t.word}`;
}

export function renderTrends(){
  const drives = loadDrives();
  renderChips();
  renderChart(drives);
}

export function openTrends(){
  renderTrends();
  showScreen('trends');
}

export function wireTrends(){
  el('btn-trends-back')?.addEventListener('click', () => showScreen('home'));

  // Chip switching — delegated, since the chips are re-rendered each open.
  el('trends-metrics')?.addEventListener('click', (e) => {
    const chip = e.target.closest?.('.trends-chip');
    if (!chip) return;
    active = chip.dataset.metric;
    renderTrends();
  });
}
