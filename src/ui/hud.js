/**
 * The driving screen's live insights: clean streak, the inputs ribbon, one quiet
 * line of insight, and the stop / mile / time stats.
 *
 * All the thinking lives in services/liveInsights.js (and is unit-tested); this file
 * only draws it. The design rule is "interesting but not noisy": a handful of things
 * that change when your driving changes, and a single message line that is blank
 * unless something is worth saying.
 */
import { createLiveInsights, createInsightFeed, ribbonSeries, longestCleanStreakMi } from '../services/liveInsights.js';
import { loadDrives } from '../services/storage.js';
import { clamp } from '../utils/math.js';
import { scoreColor } from '../utils/color.js';

const BEST_KEY    = 'smoothaf.best_streak_mi';
const WINDOW_MS   = 90_000;
const DRAW_EVERY  = 500;          // ms — the ribbon scrolls smoothly enough, and costs nothing
const SCORE_TREND_MS = 60_000;
const LA_RANGE    = 3;            // m/s² shown top-to-bottom of the ribbon (±)

let ins = null, feed = null, bestAtStart = 0, bestNow = 0;
let lastDraw = 0, scoreHist = [], lastScore = null, lastShownText = null;
const RUNS_KEY = 'smoothaf.hud_runs';
const HINT_RUNS = 3;            // explain the ribbon for your first few drives, then get out of the way
let teaching = true;

function bumpRuns(){
  let n = 0;
  try { n = (parseInt(localStorage.getItem(RUNS_KEY), 10) || 0) + 1; localStorage.setItem(RUNS_KEY, String(n)); } catch {}
  return n || 1;
}

const $id = id => document.getElementById(id);

// ── Personal best (persisted) ────────────────────────────────────────────────

function loadBest(){
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (raw != null && !Number.isNaN(parseFloat(raw))) return parseFloat(raw);
  } catch {}
  // First run of this feature: seed it from the drives already on this phone, so the
  // bar has something real to chase instead of starting at "new best!" every drive.
  let best = 0;
  try {
    for (const d of loadDrives().slice(0, 30)){
      if (d.samples && d.samples.length > 10 && !d.simulated) best = Math.max(best, longestCleanStreakMi(d.samples, d.events));
    }
  } catch {}
  best = +best.toFixed(2);
  try { localStorage.setItem(BEST_KEY, String(best)); } catch {}
  return best;
}
function saveBest(mi){
  try { localStorage.setItem(BEST_KEY, String(+mi.toFixed(2))); } catch {}
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

export function hudStart(){
  bestAtStart = loadBest(); bestNow = bestAtStart;
  ins  = createLiveInsights({ bestMi: bestAtStart });
  feed = createInsightFeed({ showMs: 5500 });
  teaching = bumpRuns() <= HINT_RUNS;
  const hint = $id('ribbon-hint'); if (hint) hint.textContent = teaching ? 'flat line = smooth' : 'last 90 s';
  lastDraw = 0; scoreHist = []; lastScore = null; lastShownText = null;
  paintStreak(0, bestAtStart, false);
  paintInsight(null);
  const d = $id('score-delta'); if (d){ d.textContent = ''; d.className = 'hero-score-delta'; }
  const r = $id('live-rolled'); if (r) r.textContent = '';
}

export function hudStop(){
  if (ins && ins.bestMi > bestAtStart) saveBest(ins.bestMi);
  ins = null; feed = null;
}

/** Call from the live tick (≈5×/s). Cheap: heavy parts are gated on new data / a timer. */
export function hudTick(st){
  if (!ins) return;
  const now = Date.now();

  // New samples/events → streak, milestones, rolled/smooth-stop detection.
  const r = ins.update(st.samples, st.events);
  bestNow = r.bestMi;
  paintStreak(r.streakMi, r.bestMi, r.isNewBest && bestAtStart >= 0.5);
  for (const i of r.insights) feed.push(i, now);
  paintInsight(feed.current(now));

  paintStats(st);
  paintScoreTrend(st, now);

  if (now - lastDraw >= DRAW_EVERY){
    lastDraw = now;
    drawRibbon($id('ribbon'), ribbonSeries(st.samples, now, WINDOW_MS), st, now);
  }
}

// ── Painting ─────────────────────────────────────────────────────────────────

let lastStreakText = '';
function paintStreak(mi, best, isBest){
  const num = $id('streak-num'), bestEl = $id('streak-best'), fill = $id('streak-fill'), box = $id('rec-streak');
  if (!num) return;
  const text = mi.toFixed(1);
  if (text !== lastStreakText){
    // A streak that just collapsed is worth a flash (the harsh-input message says why).
    if (box && lastStreakText !== '' && parseFloat(text) < parseFloat(lastStreakText) - 0.2){
      box.classList.remove('reset'); void box.offsetWidth; box.classList.add('reset');
    }
    num.textContent = text; lastStreakText = text;
  }
  // The bar chases the personal best; with no history yet it just fills toward 1 mile.
  const target = best >= 0.3 ? best : 1;
  const pct = clamp(mi / target, 0, 1) * 100;
  if (fill){ fill.style.width = pct.toFixed(1) + '%'; fill.classList.toggle('is-best', isBest || (best >= 0.3 && mi >= best)); }
  if (bestEl) bestEl.textContent = best >= 0.3 ? `best ${best.toFixed(1)}` : '';
}

function paintInsight(cur){
  const el = $id('rec-insight'); if (!el) return;
  const text = cur ? cur.text : '';
  if (text === lastShownText) return;
  $id('rec-line')?.classList.toggle('has-insight', Boolean(cur));
  lastShownText = text;
  if (!cur){ el.classList.remove('show'); return; }
  el.textContent = ''; const sp = document.createElement('span'); sp.textContent = cur.text; el.appendChild(sp);
  el.className = 'rec-insight ' + (cur.tone || '');
  void el.offsetWidth;
  el.classList.add('show');
}

function paintStats(st){
  const stops = $id('live-stops'); if (stops) stops.textContent = String(st.liveStops ?? 0);
  const rolled = $id('live-rolled');
  if (rolled && ins){ const n = ins.rolled; const t = n > 0 ? `rolled ${n}` : ''; if (rolled.textContent !== t) rolled.textContent = t; }
}

function paintScoreTrend(st, now){
  const el = $id('score-delta'); if (!el) return;
  const s = st.liveScore;
  if (s == null) return;
  if (s !== lastScore){ scoreHist.push({ t: now, s }); lastScore = s; scoreHist = scoreHist.slice(-60); }
  // The score's colour is its VALUE (same bands as the recap), not whether you happen to be
  // braking this second. It used to flash red on any gentle brake, which contradicted the
  // "Smooth stop" message right beside it. Brake/accel state still shows in the edge glows.
  const big = $id('live-score');
  if (big){ const col = scoreColor(s); if (big.dataset.c !== col){ big.style.color = col; big.dataset.c = col; } }
  // Change since about a minute ago (or the oldest we have, once there's ≥30 s of history).
  const ref = [...scoreHist].reverse().find(h => now - h.t >= SCORE_TREND_MS) || scoreHist.find(h => now - h.t >= 30_000);
  const d = ref ? s - ref.s : 0;
  const text = d >= 3 ? `▲ ${d}` : d <= -3 ? `▼ ${-d}` : '';
  const cls = 'hero-score-delta' + (d >= 3 ? ' up' : d <= -3 ? ' down' : '');
  if (el.textContent !== text) el.textContent = text;
  if (el.className !== cls) el.className = cls;
}

// ── The inputs ribbon ────────────────────────────────────────────────────────

const GREEN = '125,196,118', AMBER = '232,160,58', RED = '224,96,80', CREAM = '244,235,217';
const colorFor = (la) => { const a = Math.abs(la); return a < 1.5 ? GREEN : a < 3.0 ? AMBER : RED; };

/**
 * Your inputs over the last 90 s: the line rises when you accelerate and falls when you
 * brake, so a flat line through the middle IS smooth driving. A faint silhouette behind
 * it is your speed, so stops show up as dips to the floor.
 */
export function drawRibbon(canvas, series, st, now){
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
  if (!cssW || !cssH) return;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)){
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  }
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const padX = 10, padY = 12;
  const w = cssW - padX * 2, h = cssH - padY * 2;
  const mid = padY + h / 2;
  const yOf = (la) => mid - clamp(la / LA_RANGE, -1, 1) * (h / 2) * 0.92;
  const xOf = (x) => padX + x * w;

  // The "smooth zone" — stay inside it and you're doing it right.
  const bandHalf = (1.5 / LA_RANGE) * (h / 2) * 0.92;
  ctx.fillStyle = `rgba(${GREEN},.07)`;
  ctx.fillRect(padX, mid - bandHalf, w, bandHalf * 2);
  ctx.strokeStyle = `rgba(${CREAM},.10)`; ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
  ctx.beginPath(); ctx.moveTo(padX, mid); ctx.lineTo(padX + w, mid); ctx.stroke();
  ctx.setLineDash([]);

  if (!series.length){ return; }

  // Speed silhouette (bottom-anchored), smoothed. Stops are where it touches the floor.
  const vMax = Math.max(14, ...series.map(p => p.speed));
  const sy = (p) => padY + h - (p.speed / vMax) * h * 0.38;
  const trace = () => {
    ctx.moveTo(xOf(series[0].x), sy(series[0]));
    for (let i = 1; i < series.length; i++){
      const a = series[i - 1], b = series[i];
      ctx.quadraticCurveTo(xOf(a.x), sy(a), (xOf(a.x) + xOf(b.x)) / 2, (sy(a) + sy(b)) / 2);
    }
    const l = series[series.length - 1]; ctx.lineTo(xOf(l.x), sy(l));
  };
  ctx.beginPath(); trace(); ctx.lineTo(xOf(series[series.length - 1].x), padY + h); ctx.lineTo(xOf(series[0].x), padY + h); ctx.closePath();
  ctx.fillStyle = `rgba(${CREAM},.05)`; ctx.fill();
  ctx.beginPath(); trace(); ctx.strokeStyle = `rgba(${CREAM},.10)`; ctx.lineWidth = 1; ctx.stroke();
  if (teaching){ ctx.fillStyle = `rgba(${CREAM},.38)`; ctx.font = '600 10px system-ui, sans-serif'; ctx.textBaseline = 'bottom'; ctx.fillText('SPEED', padX + 2, padY + h - 2); }

  // Harsh inputs and full stops within the window, drawn as markers.
  const from = now - WINDOW_MS;
  for (const e of st.events || []){
    if (e.type === 'shift' || (e.tier || 2) < 2 || e.t < from) continue;
    const x = xOf((e.t - from) / WINDOW_MS);
    ctx.fillStyle = `rgba(${e.type === 'brake' ? RED : AMBER},.9)`;
    ctx.beginPath(); ctx.moveTo(x - 4.5, padY - 5); ctx.lineTo(x + 4.5, padY - 5); ctx.lineTo(x, padY + 3); ctx.closePath(); ctx.fill();
  }
  for (const m of st.liveStopMarkers || []){
    if (m.t < from) continue;
    const x = xOf((m.t - from) / WINDOW_MS);
    ctx.strokeStyle = `rgba(${CREAM},.55)`; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, padY + h - 4, 3.5, 0, Math.PI * 2); ctx.stroke();
  }

  // The line itself, coloured by how hard the input is, with a soft glow.
  ctx.lineWidth = 2.6; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (let i = 1; i < series.length; i++){
    const a = series[i - 1], b = series[i];
    const col = colorFor((a.la + b.la) / 2);
    ctx.strokeStyle = `rgba(${col},.95)`; ctx.shadowColor = `rgba(${col},.4)`; ctx.shadowBlur = 5;
    ctx.beginPath(); ctx.moveTo(xOf(a.x), yOf(a.la));
    const mx = (xOf(a.x) + xOf(b.x)) / 2;
    ctx.quadraticCurveTo(xOf(a.x), yOf(a.la), mx, (yOf(a.la) + yOf(b.la)) / 2);
    ctx.lineTo(xOf(b.x), yOf(b.la)); ctx.stroke();
  }
  ctx.shadowBlur = 0;

  // Older history ages out toward the left edge.
  const fade = ctx.createLinearGradient(padX, 0, padX + w * 0.28, 0);
  fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = fade; ctx.fillRect(padX, 0, w * 0.28, cssH);
  ctx.globalCompositeOperation = 'source-over';

  // "Now".
  const last = series[series.length - 1];
  const hx = xOf(last.x), hy = yOf(last.la), hc = colorFor(last.la);
  ctx.fillStyle = `rgba(${hc},.25)`; ctx.beginPath(); ctx.arc(hx, hy, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = `rgba(${hc},1)`;   ctx.beginPath(); ctx.arc(hx, hy, 4, 0, Math.PI * 2); ctx.fill();
}
