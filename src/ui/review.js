import { $, $$ } from '../utils/dom.js';
import { showScreen } from './router.js';
import { analyzeDrive, drivingStyleVerdict, driveCoaching } from '../services/scoring.js';
import { mpsToMph, metersToMiles, fmtDuration, clamp } from '../utils/math.js';
import { forceSegmentColor, dimColor, scoreColor } from '../utils/color.js';
import { DIM_DISPLAY } from '../constants.js';
import { loadDrives } from '../services/storage.js';

let mapInstance = null;
let mapLayers = [];
let reviewEventMarkers = { brake: [], accel: [], turn: [], stop: [] };
export let reviewDrive = null;
export let reviewAnalysis = null;

export function renderReview(drive){
  showScreen('review');
  reviewDrive = drive;

  const analysis = analyzeDrive(drive);
  reviewAnalysis = analysis;

  // ── Header ─────────────────────────────────────────────────────────────────
  const when = new Date(drive.startTime);
  $('#review-when').textContent =
    when.toLocaleDateString([], {month:'short', day:'numeric', year:'numeric'}) +
    ' · ' + when.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});

  // ── Score ──────────────────────────────────────────────────────────────────
  const scoreEl = document.getElementById('score-header-btn');
  if (scoreEl) scoreEl.textContent = analysis.score;

  // ── Events — show all detected events in chips; only tier 2+ affect score ──
  $('#ev-brake').textContent = drive.events.filter(e => e.type === 'brake').length;
  $('#ev-accel').textContent = drive.events.filter(e => e.type === 'accel').length;
  $('#ev-turn').textContent  = drive.events.filter(e => e.type === 'turn').length;
  $('#ev-stop').textContent  = analysis.stopMarkers.length;

  // ── Stat strip ─────────────────────────────────────────────────────────────
  $('#r-distance').textContent = metersToMiles(drive.distanceMeters).toFixed(1);
  $('#r-duration').textContent = fmtDuration(drive.durationMs);
  $('#r-topspeed').textContent  = Math.round(mpsToMph(drive.topSpeedMps));
  const roadEl = $('#r-road-quality');
  if (roadEl && drive.samples.length){
    const avgRough = drive.samples.reduce((s,x) => s + (x.roadRoughness || 0), 0) / drive.samples.length;
    roadEl.textContent = avgRough < 0.15 ? 'Smooth' : avgRough < 0.5 ? 'Good' : avgRough < 1.0 ? 'Fair' : 'Rough';
    roadEl.style.color = avgRough < 0.15 ? 'var(--good)' : avgRough < 0.5 ? 'var(--sage)' : avgRough < 1.0 ? 'var(--warn)' : 'var(--danger)';
  }

  // ── Force timeline chart (hidden, kept for analysis sheet) ───────────────
  renderForceTimeline(drive);

  // ── v2 What Happened + Hardest Moment ──────────────────────────────────────
  {
    const brakes   = drive.events.filter(e => e.type === 'brake').length;
    const accels   = drive.events.filter(e => e.type === 'accel').length;
    const turns    = drive.events.filter(e => e.type === 'turn').length;
    const totalEvs = brakes + accels + turns;
    const distMi   = metersToMiles(drive.distanceMeters || 0);

    const smEl = document.getElementById('rv-smooth-main');
    if (smEl) smEl.textContent = totalEvs === 0
      ? 'Perfectly clean'
      : `${Math.max(0, distMi - totalEvs * 0.15).toFixed(1)} mi smooth`;

    const ssEl = document.getElementById('rv-smooth-sub');
    if (ssEl && drive.samples.length){
      const avgRough = drive.samples.reduce((s, x) => s + (x.roadRoughness || 0), 0) / drive.samples.length;
      ssEl.textContent = 'Road: ' + (avgRough < 0.15 ? 'Smooth' : avgRough < 0.5 ? 'Good' : avgRough < 1.0 ? 'Fair' : 'Rough');
    }

    const extremeBrakes = drive.events.filter(e => e.type === 'brake' && (e.tier || 2) >= 4).length;
    const extremeAccels = drive.events.filter(e => e.type === 'accel' && (e.tier || 2) >= 4).length;
    const extremeTurns  = drive.events.filter(e => e.type === 'turn'  && (e.tier || 2) >= 4).length;

    const emEl = document.getElementById('rv-events-main');
    if (emEl) emEl.textContent = totalEvs === 0 ? 'None'
      : brakes ? (extremeBrakes ? `${extremeBrakes} extreme brake${extremeBrakes !== 1 ? 's' : ''}${brakes > extremeBrakes ? ` + ${brakes - extremeBrakes} hard` : ''}` : `${brakes} hard brake${brakes !== 1 ? 's' : ''}`)
      : accels ? (extremeAccels ? `${extremeAccels} extreme accel${extremeAccels !== 1 ? 's' : ''}` : `${accels} hard accel${accels !== 1 ? 's' : ''}`)
      : (extremeTurns ? `${extremeTurns} extreme turn${extremeTurns !== 1 ? 's' : ''}` : `${turns} sharp turn${turns !== 1 ? 's' : ''}`);

    const esEl = document.getElementById('rv-events-sub');
    if (esEl) esEl.textContent = (accels && brakes)
      ? `${accels} accel · ${turns} turn${turns !== 1 ? 's' : ''}`
      : (turns && (brakes || accels)) ? `${turns} turn${turns !== 1 ? 's' : ''}` : '';

    const worst = drive.events
      .filter(e => e.type === 'brake' || e.type === 'turn' || e.type === 'accel')
      .sort((a, b) => (b.severity || 0) - (a.severity || 0))[0];

    const worstEl    = document.getElementById('rv-worst-text');
    const worstBlock = document.getElementById('rv-worst-block');
    if (worstEl){
      if (worst){
        const isWorstExtreme = (worst.tier || 2) >= 4;
        const lbl = isWorstExtreme
          ? (worst.type === 'brake' ? 'Extreme brake' : worst.type === 'accel' ? 'Extreme accel' : 'Extreme turn')
          : (worst.type === 'brake' ? 'Hard brake'    : worst.type === 'accel' ? 'Hard accel'    : 'Sharp turn');
        worstEl.textContent = `${lbl} · ${fmtDuration(worst.t || 0)} in · ${worst.speedMph || 0} mph`;
      } else {
        worstEl.textContent = 'No harsh events — clean drive!';
      }
    }
    if (worstBlock) worstBlock.style.display = totalEvs === 0 ? 'none' : '';
  }

  // ── Coaching persona card ──────────────────────────────────────────────────
  const coachingCard = document.getElementById('rv-coaching-card');
  if (coachingCard){
    const cards     = driveCoaching(analysis);
    const topCard   = cards && cards[0];
    const personaEl = document.getElementById('rv-coaching-persona');
    const tipEl     = document.getElementById('rv-coaching-tip');
    if (topCard){
      if (personaEl) personaEl.textContent = topCard.title || '';
      if (tipEl)     tipEl.textContent     = topCard.body  || '';
      coachingCard.style.display = 'block';
    } else {
      coachingCard.style.display = 'none';
    }
  }

  // ── Route history comparison (collapsed by default) ───────────────────────
  const routeHistBlock = document.getElementById('rv-route-history');
  const routeRows      = document.getElementById('rv-route-rows');
  const routeToggle    = document.getElementById('rv-route-toggle');
  const routeCountEl   = document.getElementById('rv-route-count');
  const routeChevron   = document.getElementById('rv-route-chevron');
  if (routeHistBlock && routeRows){
    const allDrives = loadDrives().filter(d => d.score != null && d.startTime !== drive.startTime);
    const thisDur = drive.durationMs || 0;
    const similar = allDrives
      .filter(d => {
        const dur = d.durationMs || 0;
        return dur > 0 && Math.abs(dur - thisDur) / Math.max(thisDur, dur) < 0.4;
      })
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, 5);

    if (similar.length > 0){
      if (routeCountEl) routeCountEl.textContent = `${similar.length} drive${similar.length !== 1 ? 's' : ''} on this route`;
      routeRows.innerHTML = similar.map(d => {
        const diff  = d.score - drive.score;
        const delta = diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : '=';
        const cls   = diff > 0 ? 'up' : diff < 0 ? 'down' : 'same';
        const when  = new Date(d.startTime);
        const label = when.toLocaleDateString([], { month: 'short', day: 'numeric' });
        return `<div class="rv-route-row">
          <div class="rv-route-score" style="color:${scoreColor(d.score)}">${d.score}</div>
          <div class="rv-route-meta">${label} · ${fmtDuration(d.durationMs)}</div>
          <div class="rv-route-delta ${cls}">${delta}</div>
        </div>`;
      }).join('');
      routeRows.style.display = 'none'; // collapsed by default
      routeHistBlock.style.display = 'block';
      if (routeToggle){
        routeToggle.onclick = () => {
          const open = routeRows.style.display !== 'none';
          routeRows.style.display = open ? 'none' : 'block';
          if (routeChevron) routeChevron.style.transform = open ? '' : 'rotate(90deg)';
        };
      }
    } else {
      routeHistBlock.style.display = 'none';
    }
  }

  // ── Verdict + analysis sheet ──────────────────────────────────────────────
  const verdict = drivingStyleVerdict(analysis, drive);
  const vColor  = dimColor(analysis.score);

  const verdictTag = document.getElementById('score-verdict-tag');
  if (verdictTag) verdictTag.textContent = verdict.label;

  // Personal best on this route (similar duration ±40%)
  {
    const allDrives = loadDrives().filter(d => d.score != null && d.startTime !== drive.startTime);
    const thisDur = drive.durationMs || 0;
    const similar = allDrives.filter(d => {
      const dur = d.durationMs || 0;
      return dur > 0 && Math.abs(dur - thisDur) / Math.max(thisDur, dur) < 0.4;
    });
    analysis._personalBest = similar.length > 0 ? Math.max(...similar.map(d => d.score)) : null;
    analysis._personalBestDate = similar.length > 0
      ? similar.reduce((best, d) => d.score >= best.score ? d : best).startTime : null;
  }

  buildAnalysisSheet(drive, analysis, verdict, vColor);

  // Wire score number tap → open analysis sheet
  const scoreBtn = document.getElementById('score-header-btn');
  if (scoreBtn){
    scoreBtn.onclick = () => document.getElementById('analysis-sheet')?.classList.remove('hidden');
  }
  document.getElementById('as-close')?.addEventListener('click', () => {
    document.getElementById('analysis-sheet')?.classList.add('hidden');
  });

  // ── Map ────────────────────────────────────────────────────────────────────
  if (!mapInstance){
    mapInstance = L.map('map', { zoomControl: true, attributionControl: true, preferCanvas: true });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20, attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd',
    }).addTo(mapInstance);
  } else {
    mapLayers.forEach(l => mapInstance.removeLayer(l));
    mapLayers = [];
  }

  if (drive.samples.length < 2) return;

  const bounds = L.latLngBounds(drive.samples.map(s => [s.lat, s.lon]));
  mapInstance.fitBounds(bounds, { padding: [40, 40] });

  for (let i = 1; i < drive.samples.length; i++){
    const a = drive.samples[i-1], b = drive.samples[i];
    const la = ((a.la || 0) + (b.la || 0)) / 2;
    const ra = ((a.ra || 0) + (b.ra || 0)) / 2;
    const seg = L.polyline([[a.lat, a.lon], [b.lat, b.lon]], {
      color: forceSegmentColor(la, ra), weight: 6, opacity: .95, lineCap: 'round', lineJoin: 'round'
    }).addTo(mapInstance);
    mapLayers.push(seg);
  }

  // Direction-of-travel arrows — ~7 evenly spaced along the route
  const smp = drive.samples;
  const step = Math.max(1, Math.floor(smp.length / 7));
  for (let i = step; i < smp.length - 1; i += step){
    const a = smp[i], b = smp[i + 1];
    const dy = b.lat - a.lat, dx = b.lon - a.lon;
    if (Math.abs(dy) < 1e-6 && Math.abs(dx) < 1e-6) continue;
    const deg = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    const arrow = L.marker([a.lat, a.lon], {
      icon: L.divIcon({
        className: '',
        html: `<div class="route-arrow" style="transform:rotate(${deg}deg)">▲</div>`,
        iconSize: [14, 14], iconAnchor: [7, 7]
      }),
      interactive: false
    }).addTo(mapInstance);
    mapLayers.push(arrow);
  }

  const first = drive.samples[0], last = drive.samples[drive.samples.length-1];
  [
    L.marker([first.lat, first.lon], { icon: L.divIcon({ className:'', html:'<div class="start-marker"></div>', iconSize:[14,14], iconAnchor:[7,7] }) }).addTo(mapInstance).bindPopup('Start'),
    L.marker([last.lat,  last.lon],  { icon: L.divIcon({ className:'', html:'<div class="end-marker"></div>',   iconSize:[14,14], iconAnchor:[7,7] }) }).addTo(mapInstance).bindPopup('End'),
  ].forEach(m => mapLayers.push(m));

  reviewEventMarkers = { brake: [], accel: [], turn: [], stop: [] };
  for (const s of analysis.stopMarkers){
    const secs = (s.durationMs / 1000).toFixed(s.durationMs < 10000 ? 1 : 0);
    const m = L.marker([s.lat, s.lon], {
      icon: L.divIcon({ className:'', html:`<div class="ev-marker stop-pill">${secs}s</div>`, iconSize:[52,24], iconAnchor:[26,12] })
    }).addTo(mapInstance);
    m.bindPopup(`<b>Full stop</b><br>${secs}s · approach ${s.speedMph} mph<br><span style="color:#8A7B72">t+${fmtDuration(s.t)}</span>`);
    mapLayers.push(m);
    reviewEventMarkers.stop.push(m);
  }
  for (const e of drive.events){
    if (e.type === 'shift') continue;
    if ((e.tier || 2) < 3) continue; // only worst moments on map
    const glyph = e.type === 'brake' ? 'B' : e.type === 'accel' ? 'A' : 'T';
    const isExtreme = (e.tier || 2) >= 4;
    const label = isExtreme
      ? (e.type === 'brake' ? 'Extreme brake' : e.type === 'accel' ? 'Extreme acceleration' : 'Extreme turn')
      : (e.type === 'brake' ? 'Hard brake'    : e.type === 'accel' ? 'Hard acceleration'    : 'Sharp turn');
    const gVal  = e.la != null ? (Math.abs(e.la)/9.81).toFixed(2)
                : e.ra != null ? (Math.abs(e.ra)/9.81).toFixed(2)
                : (e.severity||1).toFixed(1);
    const markerSize = isExtreme ? 30 : 26;
    const m = L.marker([e.lat, e.lon], {
      icon: L.divIcon({ className:'', html:`<div class="ev-marker ${e.type}${isExtreme ? ' tier-4' : ''}">${glyph}</div>`, iconSize:[markerSize,markerSize], iconAnchor:[markerSize/2,markerSize/2] })
    }).addTo(mapInstance);
    if (e.type === 'brake'){
      m.on('click', () => showBrakeProfile(e, drive));
    } else {
      m.bindPopup(`<b>${label}</b><br>${e.speedMph} mph · ${gVal}G peak`);
    }
    mapLayers.push(m);
    if (reviewEventMarkers[e.type]) reviewEventMarkers[e.type].push(m);
  }

  setTimeout(() => mapInstance.invalidateSize(), 80);
}

// -------------------------------------------------------------------------
// Analysis sheet builder — all 20 stats
// -------------------------------------------------------------------------
function buildAnalysisSheet(drive, analysis, verdict, vColor){
  const asVerdict = document.getElementById('as-verdict-label');
  const asSub     = document.getElementById('as-verdict-sub');
  if (asVerdict){ asVerdict.textContent = verdict.label; asVerdict.style.color = vColor; }
  if (asSub) asSub.textContent = verdict.sub;

  function flyTo(lat, lon){
    document.getElementById('analysis-sheet')?.classList.add('hidden');
    if (mapInstance) mapInstance.setView([lat, lon], 17, { animate: true });
  }
  function fmtSecs(s){ return s >= 60 ? `${Math.floor(s/60)}m ${s%60}s` : `${s}s`; }

  // ── Peak Forces ───────────────────────────────────────────────────────────
  const peaksEl = document.getElementById('as-peaks');
  if (peaksEl){
    const rows = [
      { label:'Braking',   peak:analysis.peakBrakeG, avg:analysis.avgBrakeG, ev:analysis.peakBrakeEv, color:'var(--danger)' },
      { label:'Cornering', peak:analysis.peakTurnG,  avg:analysis.avgTurnG,  ev:analysis.peakTurnEv,  color:'var(--gold)'   },
      { label:'Accel',     peak:analysis.peakAccelG, avg:analysis.avgAccelG, ev:analysis.peakAccelEv, color:'var(--warn)'   },
    ];
    peaksEl.innerHTML = rows.map(r => {
      const hasPeak = r.peak != null;
      return `<div class="as-peak-row">
        <div class="as-peak-label">${r.label}</div>
        <div class="as-peak-nums">
          <span class="as-peak-val" style="color:${hasPeak ? r.color : 'rgba(242,232,213,.2)'}">${hasPeak ? r.peak + 'G' : '—'}</span>
          ${hasPeak && r.avg ? `<span class="as-peak-avg">avg ${r.avg}G</span>` : ''}
        </div>
        ${hasPeak && r.ev ? `<button class="as-map-btn" data-lat="${r.ev.lat}" data-lon="${r.ev.lon}">map ›</button>` : '<div></div>'}
      </div>`;
    }).join('');
    peaksEl.querySelectorAll('.as-map-btn').forEach(btn => {
      btn.onclick = () => flyTo(+btn.dataset.lat, +btn.dataset.lon);
    });
  }

  // ── Drive Scores (7 dims) ─────────────────────────────────────────────────
  const dimsEl = document.getElementById('as-dims-list');
  if (dimsEl){
    dimsEl.innerHTML = DIM_DISPLAY.map(({ key, label }) => {
      const val   = analysis.dims[key] || 0;
      const color = dimColor(val);
      return `<div class="as-dim">
        <div class="as-dim-score" style="color:${color}">${val}</div>
        <div class="as-dim-label">${label}</div>
      </div>`;
    }).join('');
  }

  // ── Speed & Flow ──────────────────────────────────────────────────────────
  const speedEl = document.getElementById('as-speed');
  if (speedEl){
    const topMph = Math.round(mpsToMph(drive.topSpeedMps || 0));
    const vsStr = analysis.avgVsLimit == null ? null
      : analysis.avgVsLimit > 0 ? `+${analysis.avgVsLimit} vs limit`
      : analysis.avgVsLimit < 0 ? `${analysis.avgVsLimit} vs limit`
      : 'at limit';
    const aboveStr = analysis.secAboveLimit != null && analysis.secAboveLimit > 0
      ? fmtSecs(analysis.secAboveLimit) + ' over' : null;
    const limitLbl = analysis.limitMph != null ? `Above ${analysis.limitMph} mph` : 'Above Limit';
    const cells = [
      { val:`${topMph} mph`, lbl:'Top Speed', sub:null, tapLat:drive.topSpeedLat, tapLon:drive.topSpeedLon },
      { val:`${analysis.avgSpeedMph || '—'} mph`, lbl:'Avg Speed', sub:vsStr, tapLat:null, tapLon:null },
      { val:analysis.speedStdDevMph != null ? `±${analysis.speedStdDevMph} mph` : '—', lbl:'Consistency', sub:null, tapLat:null, tapLon:null },
      { val:aboveStr || (analysis.limitMph != null ? '0s' : '—'), lbl:limitLbl, sub:null, tapLat:null, tapLon:null },
    ];
    speedEl.innerHTML = `<div class="as-stats-2">${cells.map(c => {
      const tap = c.tapLat != null;
      return `<div class="as-stat${tap ? ' tappable' : ''}"${tap ? ` data-lat="${c.tapLat}" data-lon="${c.tapLon}"` : ''}>
        <div class="as-stat-val">${c.val}</div>
        <div class="as-stat-lbl">${c.lbl}</div>
        ${c.sub ? `<div class="as-stat-sub">${c.sub}</div>` : ''}
      </div>`;
    }).join('')}</div>`;
    speedEl.querySelectorAll('.as-stat.tappable').forEach(el => {
      el.onclick = () => flyTo(+el.dataset.lat, +el.dataset.lon);
    });
  }

  // ── Smoothness ────────────────────────────────────────────────────────────
  const smoothEl = document.getElementById('as-smooth');
  if (smoothEl){
    const cells = [
      { val:analysis.smoothStreakMi != null ? `${analysis.smoothStreakMi} mi` : '—', lbl:'Clean Streak' },
      { val:analysis.coastPct != null ? `${analysis.coastPct}%` : '—',              lbl:'Coasting'     },
      { val:analysis.harshPerMi != null ? String(analysis.harshPerMi) : '—',        lbl:'Events / mi'  },
      { val:analysis.hardBrakeEntryMph != null ? `${analysis.hardBrakeEntryMph} mph` : '—', lbl:'Hard-Brake Entry' },
    ];
    smoothEl.innerHTML = `<div class="as-stats-2">${cells.map(c =>
      `<div class="as-stat">
        <div class="as-stat-val">${c.val}</div>
        <div class="as-stat-lbl">${c.lbl}</div>
      </div>`
    ).join('')}</div>`;
  }

  // ── Drive Context ─────────────────────────────────────────────────────────
  const ctxEl = document.getElementById('as-context');
  if (ctxEl){
    const pb    = analysis._personalBest;
    const pbDate = analysis._personalBestDate
      ? new Date(analysis._personalBestDate).toLocaleDateString([], { month:'short', day:'numeric' }) : '';
    let bestLine = 'First drive on this route';
    if (pb != null){
      const diff = analysis.score - pb;
      bestLine = diff > 0 ? 'New personal best ▲'
               : diff < 0 ? `Best: ${pb} (${pbDate})`
               : `Matched best: ${pb}`;
    }
    const grade = analysis.letterGrade || '—';
    const gradeColor = analysis.score >= 90 ? 'var(--good)' : analysis.score >= 75 ? 'var(--warn)' : 'var(--danger)';

    ctxEl.innerHTML = `
      <div class="as-grade-block">
        <span class="as-grade-letter" style="color:${gradeColor}">${grade}</span>
        <div class="as-grade-meta">
          <div class="as-stat-lbl">Drive Grade</div>
          <div class="as-grade-best">${bestLine}</div>
        </div>
      </div>
      <div class="as-stats-3" style="margin-top:8px">
        <div class="as-stat">
          <div class="as-stat-val">${analysis.shiftCount != null ? analysis.shiftCount : '—'}</div>
          <div class="as-stat-lbl">Shifts</div>
        </div>
        <div class="as-stat">
          <div class="as-stat-val">${analysis.fullStops}</div>
          <div class="as-stat-lbl">Full Stops</div>
          <div class="as-stat-sub">${analysis.stopsPerMile != null ? analysis.stopsPerMile.toFixed(1) + '/mi' : ''}</div>
        </div>
        <div class="as-stat">
          <div class="as-stat-val">${analysis.dims.transitions || '—'}</div>
          <div class="as-stat-lbl">Transitions</div>
          <div class="as-stat-sub">jerk score</div>
        </div>
      </div>`;
  }
}


export function renderForceTimeline(drive){
  const canvas = document.getElementById('force-timeline-canvas');
  if (!canvas || !drive || drive.samples.length < 2) return;
  requestAnimationFrame(() => {
    const dpr   = window.devicePixelRatio || 1;
    const W     = canvas.offsetWidth;
    const H     = canvas.offsetHeight;
    if (!W || !H) return;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const smp   = drive.samples;
    const t0    = smp[0].t, tEnd = smp[smp.length-1].t;
    const tSpan = tEnd - t0 || 1;

    // Y: center = zero, positive la = accel (upward), negative la = brake (downward)
    const allAbs  = smp.flatMap(s => [Math.abs(s.la || 0), Math.abs(s.ra || 0)]);
    const maxForce = Math.max(1.2, ...allAbs);
    const tx = t  => ((t - t0) / tSpan) * W;
    const ty = v  => H * 0.5 * (1 - v / maxForce);
    const zero = ty(0);

    ctx.clearRect(0, 0, W, H);

    // Subtle zone backgrounds
    ctx.fillStyle = 'rgba(232,160,58,.05)';
    ctx.fillRect(0, 0, W, zero);            // upper = accel zone
    ctx.fillStyle = 'rgba(224,59,47,.05)';
    ctx.fillRect(0, zero, W, H - zero);    // lower = brake zone

    // Zero line
    ctx.strokeStyle = 'rgba(244,235,217,.18)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, zero); ctx.lineTo(W, zero); ctx.stroke();

    // ── Accel fill (la > 0, plots above center) ───────────────────────────
    ctx.beginPath();
    ctx.moveTo(tx(smp[0].t), zero);
    smp.forEach(s => ctx.lineTo(tx(s.t), (s.la||0) > 0.05 ? ty(s.la) : zero));
    ctx.lineTo(tx(smp[smp.length-1].t), zero);
    ctx.closePath();
    const aGrad = ctx.createLinearGradient(0, 0, 0, zero);
    aGrad.addColorStop(0, 'rgba(232,160,58,.6)');
    aGrad.addColorStop(1, 'rgba(232,160,58,.08)');
    ctx.fillStyle = aGrad;
    ctx.fill();

    // ── Brake fill (la < 0, plots below center) ───────────────────────────
    ctx.beginPath();
    ctx.moveTo(tx(smp[0].t), zero);
    smp.forEach(s => ctx.lineTo(tx(s.t), (s.la||0) < -0.05 ? ty(s.la) : zero));
    ctx.lineTo(tx(smp[smp.length-1].t), zero);
    ctx.closePath();
    const bGrad = ctx.createLinearGradient(0, zero, 0, H);
    bGrad.addColorStop(0, 'rgba(224,59,47,.08)');
    bGrad.addColorStop(1, 'rgba(224,59,47,.6)');
    ctx.fillStyle = bGrad;
    ctx.fill();

    // ── La main line ──────────────────────────────────────────────────────
    ctx.beginPath();
    smp.forEach((s, i) => {
      const x = tx(s.t), y = ty(s.la || 0);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = 'rgba(244,235,217,.4)';
    ctx.lineWidth   = 1.5;
    ctx.lineJoin    = 'round';
    ctx.stroke();

    // ── Ra line (lateral / turning — gold) ───────────────────────────────
    ctx.beginPath();
    smp.forEach((s, i) => {
      const x = tx(s.t), y = ty(s.ra || 0);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = 'rgba(196,169,98,.55)';
    ctx.lineWidth   = 1;
    ctx.lineJoin    = 'round';
    ctx.stroke();

    // Event tick marks: tier 2+ hairlines, tier 4 taller + fully opaque
    drive.events.forEach(e => {
      if ((e.tier || 2) < 2 || e.type === 'shift') return;
      const isExtreme = (e.tier || 2) >= 4;
      const x       = tx(e.t);
      const opacity = isExtreme ? 1.0 : 0.6;
      const tickH   = isExtreme ? H * 0.30 : H * 0.18;
      const color   = e.type === 'brake' ? `rgba(224,59,47,${opacity})` : e.type === 'accel' ? `rgba(232,160,58,${opacity})` : `rgba(196,169,98,${opacity})`;
      ctx.strokeStyle = color;
      ctx.lineWidth   = isExtreme ? 1.5 : 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, tickH); ctx.stroke();
    });
    ctx.lineWidth = 1;
  });
}

// -------------------------------------------------------------------------
// Brake event deceleration profile panel + sparkline
// -------------------------------------------------------------------------
export function showBrakeProfile(e, drive){
  const existing = document.getElementById('brake-detail-panel');
  if (existing) existing.remove();

  const PRE_MS  = 4000;
  const POST_MS = 6000;
  const slice = drive.samples.filter(s => s.t >= e.t - PRE_MS && s.t <= e.t + POST_MS);
  if (slice.length < 2) return;

  const laVals  = slice.map(s => s.la || 0);
  const minLa   = Math.min(-0.3, ...laVals);
  const maxLa   = Math.max( 0.3, ...laVals);
  const peakLa  = Math.min(...laVals);
  const peakG   = (Math.abs(peakLa) / 9.81).toFixed(2);
  const peakMs2 = Math.abs(peakLa).toFixed(1);

  const brakePts = slice.filter(s => (s.la || 0) < -0.3);
  const dur = brakePts.length >= 2
    ? ((brakePts[brakePts.length-1].t - brakePts[0].t) / 1000).toFixed(1)
    : brakePts.length === 1 ? '<1' : '—';

  const qualLabel = peakG >= 0.4 ? 'Hard' : peakG >= 0.2 ? 'Moderate' : 'Light';
  const qualColor = peakG >= 0.4 ? 'var(--danger)' : peakG >= 0.2 ? 'var(--warn)' : 'var(--good)';

  const panel = document.createElement('div');
  panel.id = 'brake-detail-panel';
  panel.className = 'brake-detail-panel';
  panel.innerHTML = `
    <div class="bdp-header">
      <span class="bdp-title" style="color:${qualColor}">${qualLabel} brake</span>
      <span class="bdp-meta">${e.speedMph} mph entry · tier ${e.tier || 2}</span>
      <button class="bdp-close" aria-label="Close">×</button>
    </div>
    <canvas class="brake-spark" id="brake-spark"></canvas>
    <div class="bdp-stats">
      <div class="bdp-stat">
        <div class="bdp-stat-v" style="color:${qualColor}">${peakG}<span class="bdp-stat-u">G</span></div>
        <div class="bdp-stat-l">Peak G</div>
      </div>
      <div class="bdp-stat">
        <div class="bdp-stat-v">${peakMs2}<span class="bdp-stat-u">m/s²</span></div>
        <div class="bdp-stat-l">Peak force</div>
      </div>
      <div class="bdp-stat">
        <div class="bdp-stat-v">${dur}<span class="bdp-stat-u">s</span></div>
        <div class="bdp-stat-l">Duration</div>
      </div>
      <div class="bdp-stat">
        <div class="bdp-stat-v">${e.speedMph}<span class="bdp-stat-u">mph</span></div>
        <div class="bdp-stat-l">Entry</div>
      </div>
    </div>`;

  const mapBlock = document.querySelector('.review-map-block');
  if (!mapBlock) return;
  mapBlock.appendChild(panel);
  panel.querySelector('.bdp-close').onclick = () => panel.remove();

  requestAnimationFrame(() =>
    drawBrakeSparkline(document.getElementById('brake-spark'), slice, e.t, minLa, maxLa)
  );
}

function drawBrakeSparkline(canvas, slice, eventT, minLa, maxLa){
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth;
  const H   = canvas.offsetHeight;
  if (!W || !H) return;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const t0    = slice[0].t;
  const tSpan = (slice[slice.length-1].t - t0) || 1;
  const laRange = maxLa - minLa || 1;

  const tx = t  => ((t - t0) / tSpan) * W;
  const ty = la => H * (maxLa - la) / laRange;
  const zero = ty(0);

  // Zero baseline
  ctx.strokeStyle = 'rgba(244,235,217,.14)';
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.moveTo(0, zero); ctx.lineTo(W, zero); ctx.stroke();

  // Event timestamp dashed line
  const ex = tx(eventT);
  if (ex >= 0 && ex <= W){
    ctx.strokeStyle = 'rgba(224,59,47,.45)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(ex, 0); ctx.lineTo(ex, H); ctx.stroke();
    ctx.setLineDash([]);
  }

  const pts = slice.map(s => ({ x: tx(s.t), y: ty(s.la || 0) }));

  // Filled area under the curve
  ctx.beginPath();
  ctx.moveTo(pts[0].x, zero);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length-1].x, zero);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(224,59,47,.48)');
  grad.addColorStop(1, 'rgba(224,59,47,.04)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Stroke line
  ctx.beginPath();
  pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
  ctx.strokeStyle = '#E03B2F';
  ctx.lineWidth   = 2.5;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';
  ctx.stroke();

  // Peak G label
  const peakPt = pts.reduce((a, b) => b.y > a.y ? b : a); // highest y = most negative la
  ctx.fillStyle = 'rgba(224,59,47,.9)';
  ctx.font      = `bold ${9 * dpr / dpr}px var(--sans)`;
  ctx.textAlign = 'center';
  ctx.fillText(`${(Math.abs(Math.min(...slice.map(s=>s.la||0)))/9.81).toFixed(2)}G`, clamp(peakPt.x, 18, W-18), Math.max(10, peakPt.y - 6));
}

export function enterMapFilter(type){
  if (!mapInstance) return;
  const mapBlock = document.querySelector('.review-map-block');
  const btn = document.getElementById('btn-map-expand');
  if (mapBlock && !mapBlock.classList.contains('map-full')){
    mapBlock.classList.add('map-full');
    if (btn){ btn.textContent = '×'; btn.setAttribute('aria-label', 'Close map'); }
    setTimeout(() => mapInstance.invalidateSize(), 100);
  }
  ['brake','accel','turn','stop'].forEach(t => {
    reviewEventMarkers[t].forEach(m => {
      if (t === type){ if (!mapInstance.hasLayer(m)) m.addTo(mapInstance); }
      else           { if (mapInstance.hasLayer(m))  mapInstance.removeLayer(m); }
    });
  });
  const pts = reviewEventMarkers[type].map(m => m.getLatLng());
  if (pts.length) mapInstance.fitBounds(L.latLngBounds(pts), { padding:[60,60] });
  const badge = document.getElementById('map-filter-badge');
  const labelEl = document.getElementById('map-filter-label');
  if (badge && labelEl){
    const labels = { brake:'BRAKES', accel:'ACCELS', turn:'TURNS', stop:'FULL STOPS' };
    labelEl.textContent = labels[type] || type.toUpperCase();
    badge.classList.add('visible');
  }
}

export function clearMapFilter(){
  if (!mapInstance) return;
  ['brake','accel','turn','stop'].forEach(t => {
    reviewEventMarkers[t].forEach(m => { if (!mapInstance.hasLayer(m)) m.addTo(mapInstance); });
  });
  const badge = document.getElementById('map-filter-badge');
  if (badge) badge.classList.remove('visible');
  if (reviewDrive && reviewDrive.samples.length){
    const bounds = L.latLngBounds(reviewDrive.samples.map(s => [s.lat, s.lon]));
    mapInstance.fitBounds(bounds, { padding:[40,40] });
  }
}

export { mapInstance };

export function fitRouteToMap(){
  if (!mapInstance || !reviewDrive || !reviewDrive.samples || reviewDrive.samples.length < 2) return;
  mapInstance.invalidateSize();
  const bounds = L.latLngBounds(reviewDrive.samples.map(s => [s.lat, s.lon]));
  mapInstance.fitBounds(bounds, { padding: [48, 48] });
}
