import { $, $$ } from '../utils/dom.js';
import {
  loadDrives,
  loadLifetimeScore,
  toggleFavoriteDrive,
  deleteDrive,
  loadDriverName,
} from '../services/storage.js';
import { getDriverPersona, analyzeDrive } from '../services/scoring.js';
import { metersToMiles, fmtDuration } from '../utils/math.js';
import { scoreColor, dimColor } from '../utils/color.js';
import { DIM_DISPLAY } from '../constants.js';
import { renderReview } from './review.js';
import { restoreDrivesFromCloud } from '../services/drive.js';
import { getActiveVehicle } from './garage.js';

export function renderHomeStats(){
  const all   = loadDrives().filter(d => d.score != null);
  const score = loadLifetimeScore();

  const scoreEl = document.getElementById('home-score-num');
  if (scoreEl) {
    scoreEl.textContent = all.length ? Math.round(score) : '--';
    scoreEl.style.cursor = all.length ? 'pointer' : '';
    scoreEl.onclick = all.length ? () => renderLifetimeSheet(all) : null;
  }

  const p = getDriverPersona(all);
  const titleEl = document.getElementById('home-persona-title');
  const subEl   = document.getElementById('home-persona-sub');
  if (titleEl) titleEl.textContent = p ? p.title : '';
  if (subEl)   subEl.textContent   = p ? p.sub   : '';

  // Vehicle name in score-right
  const vehicleNameEl = document.getElementById('home-vehicle-name');
  if (vehicleNameEl){
    const v = getActiveVehicle();
    vehicleNameEl.textContent = v ? (v.model || v.make || 'My Car') : 'Add Vehicle';
  }

  // Welcome name
  const welcomeEl = document.getElementById('home-welcome-name');
  if (welcomeEl){
    const name = loadDriverName();
    welcomeEl.textContent = name ? `Back at it, ${name}` : 'Hey, Driver';
  }

  // Persona sentence — score number shown above, just describe the archetype here
  const sentenceEl = document.getElementById('home-score-sentence');
  if (sentenceEl){
    if (!all.length){
      sentenceEl.innerHTML = 'First lap unscored. Tap <em>Start Drive</em> — it scores itself.';
    } else if (p){
      sentenceEl.innerHTML = `<em>${p.title}</em> — ${p.sub}`;
    } else {
      sentenceEl.innerHTML = `${all.length} drive${all.length !== 1 ? 's' : ''} in the books. Keep stacking.`;
    }
  }

  const drivesEl = document.getElementById('home-drives-count');
  if (drivesEl) drivesEl.textContent = all.length;

  const drivesCol = document.getElementById('home-drives-col');
  if (drivesCol){
    drivesCol.onclick = () => {
      const panel = document.getElementById('drives-list-panel');
      if (panel) panel.classList.toggle('open');
    };
  }

  const milesEl = document.getElementById('home-total-miles');
  if (milesEl) milesEl.textContent = all.length
    ? Math.round(all.reduce((s, d) => s + metersToMiles(d.distanceMeters || 0), 0))
    : 0;

  const scored = all.filter(d => d.score != null);
  const bestEl = document.getElementById('home-best-score');
  if (bestEl) {
    if (scored.length) {
      const bestDrive = scored.reduce((a, b) => b.score > a.score ? b : a);
      bestEl.textContent = bestDrive.score;
      bestEl.onclick = () => renderReview(bestDrive);
    } else {
      bestEl.textContent = '--';
      bestEl.onclick = null;
    }
  }

  // 7-day sparkline (most-recent drives, oldest first)
  const now  = Date.now();
  const week = all.filter(d => now - d.startTime < 7 * 86400000).slice(0, 7).reverse();
  const sparkLine = document.getElementById('home-sparkline-line');
  const sparkDot  = document.getElementById('home-sparkline-dot');
  if (sparkLine && week.length > 1){
    const vals = week.map(d => d.score);
    const min  = Math.min(...vals), max = Math.max(...vals);
    const rng  = max - min || 1;
    const pts  = vals.map((v, i) => {
      const x = Math.round(i / (vals.length - 1) * 342);
      const y = Math.round(44 - ((v - min) / rng) * 36);
      return x + ',' + y;
    }).join(' ');
    sparkLine.setAttribute('points', pts);
    if (sparkDot){
      const lx = 342;
      const ly = Math.round(44 - ((vals[vals.length - 1] - min) / rng) * 36);
      sparkDot.setAttribute('cx', lx);
      sparkDot.setAttribute('cy', ly);
      sparkDot.setAttribute('r', '3');
    }
  }

  // Next unlock hint
  const unlockEl = document.getElementById('home-unlock-text');
  if (unlockEl){
    if (!all.length){
      unlockEl.textContent = 'Drive smooth to earn rewards →';
    } else if (all.length < 5){
      const n = 5 - all.length;
      unlockEl.textContent = `${n} more drive${n !== 1 ? 's' : ''} to unlock "Smooth Starter" badge →`;
    } else if (all.length < 10){
      const n = 10 - all.length;
      unlockEl.textContent = `${n} more drive${n !== 1 ? 's' : ''} to hit the 10-drive milestone →`;
    } else {
      unlockEl.textContent = 'Keep it silky to climb your lifetime rank →';
    }
  }
}


function renderLifetimeSheet(all){
  // Gather 7-dim scores — use stored dims if available, re-run analyzeDrive otherwise
  const dimSets = [];
  for (const d of all){
    if (d.dims){
      dimSets.push(d.dims);
    } else if (d.samples && d.samples.length >= 3){
      dimSets.push(analyzeDrive(d).dims);
    }
  }

  const statsEl = document.getElementById('lt-stats');
  if (statsEl){
    const totalMiles = Math.round(all.reduce((s, d) => s + metersToMiles(d.distanceMeters || 0), 0));
    const avgScore   = Math.round(all.reduce((s, d) => s + d.score, 0) / all.length);
    const bestScore  = Math.max(...all.map(d => d.score));
    statsEl.innerHTML = `<div class="as-stats-2">
      <div class="as-stat"><div class="as-stat-val">${all.length}</div><div class="as-stat-lbl">Drives</div></div>
      <div class="as-stat"><div class="as-stat-val">${avgScore}</div><div class="as-stat-lbl">Avg Score</div></div>
      <div class="as-stat"><div class="as-stat-val">${bestScore}</div><div class="as-stat-lbl">Best Score</div></div>
      <div class="as-stat"><div class="as-stat-val">${totalMiles}</div><div class="as-stat-lbl">Total Miles</div></div>
    </div>`;
  }

  const dimsEl = document.getElementById('lt-dims');
  if (dimsEl){
    if (dimSets.length){
      const avg = {};
      for (const key of Object.keys(dimSets[0])){
        avg[key] = Math.round(dimSets.reduce((s, d) => s + (d[key] || 0), 0) / dimSets.length);
      }
      dimsEl.innerHTML = DIM_DISPLAY.map(({ key, label }) => `
        <div class="as-dim">
          <div class="as-dim-score" style="color:${dimColor(avg[key] || 0)}">${avg[key] || 0}</div>
          <div class="as-dim-label">${label}</div>
        </div>`).join('');
    } else {
      dimsEl.innerHTML = '<div style="color:rgba(242,232,213,.35);font-size:13px;padding:8px 0">Drive more to unlock dimension data</div>';
    }
  }

  document.getElementById('lifetime-sheet')?.classList.remove('hidden');
}

/**
 * Markup for the cloud-restore control. Rendered in BOTH the empty state and
 * below an existing list — a returning driver may already have a drive or two
 * on the new install, which would otherwise hide the only way to get their
 * history back.
 */
function restoreBoxHtml(){
  return `
    <details class="restore-box">
      <summary class="restore-toggle">Driven before? Restore your history ›</summary>
      <div class="restore-body">
        <p class="restore-hint">Paste the device ID from a previous install to pull those drives down from the cloud.</p>
        <input class="restore-input" id="restore-device-id" placeholder="xxxxxxxx-xxxx-…" autocapitalize="off" autocorrect="off" spellcheck="false">
        <button class="restore-btn" id="restore-go">Restore</button>
        <div class="restore-status" id="restore-status"></div>
      </div>
    </details>`;
}

export function renderDriveList(){
  const host = $('#drives-container');
  const all = loadDrives();
  renderHomeStats();
  if (!all.length){
    // Empty history is also what a fresh install / new device looks like, so
    // offer the cloud restore right here rather than burying it in settings.
    host.innerHTML = `
      <div class="empty-drives">
        <div>No drives yet. Tap start.</div>
${restoreBoxHtml()}
      </div>`;
    wireRestore();
    return;
  }
  const sorted = all
    .map((d, i) => ({d, i}))
    .sort((a, b) => (b.d.starred ? 1 : 0) - (a.d.starred ? 1 : 0));
  host.innerHTML = sorted.map(({d, i}) => {
    const when = new Date(d.startTime);
    const mi = d.distanceMeters ? metersToMiles(d.distanceMeters).toFixed(1) : '0.0';
    return `
      <div class="drive-row" data-idx="${i}">
        <div class="drive-score" style="color:${scoreColor(d.score)}">${d.score}</div>
        <div class="drive-meta">
          <div class="drive-when">${when.toLocaleDateString([], {month:'short', day:'numeric'})} · ${when.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}</div>
          <div class="drive-stats">${mi} MI · ${fmtDuration(d.durationMs)} · ${d.eventCount || 0} events</div>
        </div>
        <div class="drive-actions">
          <button class="drive-star-btn${d.starred ? ' starred' : ''}" data-idx="${i}" aria-label="Favorite">${d.starred ? '★' : '☆'}</button>
          <button class="drive-del-btn" data-idx="${i}" aria-label="Delete">×</button>
        </div>
      </div>`;
  }).join('') + `<div class="restore-after-list">${restoreBoxHtml()}</div>`;
  wireRestore();
  $$('#drives-container .drive-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('.drive-star-btn, .drive-del-btn')) return;
      const idx = Number(row.dataset.idx);
      renderReview(loadDrives()[idx]);
    });
  });
  $$('#drives-container .drive-star-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleFavoriteDrive(Number(btn.dataset.idx), { onUpdate: () => renderDriveList() });
    });
  });
  $$('#drives-container .drive-del-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (btn.dataset.confirm === '1'){
        deleteDrive(Number(btn.dataset.idx), { onUpdate: () => renderDriveList() });
      } else {
        btn.dataset.confirm = '1';
        btn.textContent = 'Delete?';
        btn.classList.add('confirming');
        setTimeout(() => {
          btn.dataset.confirm = '0';
          btn.textContent = '×';
          btn.classList.remove('confirming');
        }, 2500);
      }
    });
  });
}

/**
 * Wire the empty-state "restore from cloud" control. Transitional until real
 * accounts land — at that point the device-ID field goes away and sign-in
 * drives the same restoreDrivesFromCloud() path.
 */
function wireRestore(){
  const btn = document.getElementById('restore-go');
  const input = document.getElementById('restore-device-id');
  const status = document.getElementById('restore-status');
  if (!btn || !input || !status) return;
  btn.addEventListener('click', async () => {
    const id = input.value.trim();
    if (!id){ status.textContent = 'Enter a device ID first.'; return; }
    btn.disabled = true;
    status.textContent = 'Restoring…';
    const result = await restoreDrivesFromCloud(id);
    btn.disabled = false;
    if (!result){
      status.textContent = "Couldn't reach the cloud — check your connection and try again.";
      return;
    }
    if (result.added === 0){
      status.textContent = result.fetched === 0
        ? 'No drives found for that device ID.'
        : 'Already up to date.';
      return;
    }
    status.textContent = `Restored ${result.added} drive${result.added === 1 ? '' : 's'}.`;
    renderDriveList();
  });
}
