import { $, $$ } from '../utils/dom.js';
import {
  loadDrives,
  loadLifetimeScore,
  toggleFavoriteDrive,
  deleteDrive,
  loadDriverName,
} from '../services/storage.js';
import { getDriverPersona } from '../services/scoring.js';
import { metersToMiles, fmtDuration } from '../utils/math.js';
import { scoreColor } from '../utils/color.js';
import { renderReview } from './review.js';

export function renderHomeStats(){
  const all   = loadDrives().filter(d => d.score != null);
  const score = loadLifetimeScore();

  const scoreEl = document.getElementById('home-score-num');
  if (scoreEl) scoreEl.textContent = all.length ? Math.round(score) : '--';

  const p = getDriverPersona(all);
  const titleEl = document.getElementById('home-persona-title');
  const subEl   = document.getElementById('home-persona-sub');
  if (titleEl) titleEl.textContent = p ? p.title : '';
  if (subEl)   subEl.textContent   = p ? p.sub   : '';

  // Welcome name
  const welcomeEl = document.getElementById('home-welcome-name');
  if (welcomeEl){
    const name = loadDriverName();
    welcomeEl.textContent = name ? `Welcome back, ${name}!` : 'Hey, Driver';
  }

  // Persona sentence — score number shown above, just describe the archetype here
  const sentenceEl = document.getElementById('home-score-sentence');
  if (sentenceEl){
    if (!all.length){
      sentenceEl.innerHTML = 'Start driving to build your score.';
    } else if (p){
      sentenceEl.innerHTML = `<em>${p.title}</em> — ${p.sub}`;
    } else {
      sentenceEl.innerHTML = `${all.length} drive${all.length !== 1 ? 's' : ''} logged. Keep going.`;
    }
  }

  // Routes text
  const routesEl = document.getElementById('home-routes-text');
  if (routesEl){
    if (!all.length){
      routesEl.textContent = 'Drive more to unlock corridor rankings.';
    } else if (all.length < 5){
      routesEl.textContent = `${all.length} drive${all.length !== 1 ? 's' : ''} logged. Keep going to unlock neighborhood rankings.`;
    } else {
      routesEl.textContent = `${all.length} drives logged. Corridor rankings unlock at 10 drives.`;
    }
  }

  const drivesEl = document.getElementById('home-drives-count');
  if (drivesEl) drivesEl.textContent = all.length;

  const milesEl = document.getElementById('home-total-miles');
  if (milesEl) milesEl.textContent = all.length
    ? Math.round(all.reduce((s, d) => s + metersToMiles(d.distanceMeters || 0), 0))
    : 0;

  const bestEl = document.getElementById('home-best-score');
  if (bestEl) bestEl.textContent = all.length ? Math.max(...all.map(d => d.score)) : '--';

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
      const y = Math.round(32 - ((v - min) / rng) * 24);
      return x + ',' + y;
    }).join(' ');
    sparkLine.setAttribute('points', pts);
    if (sparkDot){
      const lx = 342;
      const ly = Math.round(32 - ((vals[vals.length - 1] - min) / rng) * 24);
      sparkDot.setAttribute('cx', lx);
      sparkDot.setAttribute('cy', ly);
      sparkDot.setAttribute('r', '3');
    }
  }

  // Next unlock hint
  const unlockEl = document.getElementById('home-unlock-text');
  if (unlockEl){
    if (!all.length){
      unlockEl.textContent = 'Start driving to earn rewards →';
    } else if (all.length < 5){
      const n = 5 - all.length;
      unlockEl.textContent = `${n} more drive${n !== 1 ? 's' : ''} to unlock "Smooth Starter" badge →`;
    } else if (all.length < 10){
      const n = 10 - all.length;
      unlockEl.textContent = `${n} more drive${n !== 1 ? 's' : ''} to unlock the 10-drive milestone →`;
    } else {
      unlockEl.textContent = 'Keep driving to climb your lifetime rank →';
    }
  }
}

export function renderDriveList(){
  const host = $('#drives-container');
  const all = loadDrives();
  renderHomeStats();
  if (!all.length){
    host.innerHTML = '<div class="empty-drives">No drives yet. Tap start.</div>';
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
  }).join('');
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
