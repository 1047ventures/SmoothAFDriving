import { $, $$ } from '../utils/dom.js';
import {
  loadDrives,
  loadLifetimeScore,
  toggleFavoriteDrive,
  deleteDrive,
  loadDriverName,
  loadCorridors,
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

  // Routes text
  const routesEl = document.getElementById('home-routes-text');
  if (routesEl){
    if (!all.length){
      routesEl.textContent = 'Drive a route 3× to unlock your Corridor rank — and find out who owns your block.';
    } else if (all.length < 3){
      routesEl.textContent = `${3 - all.length} more drive${3 - all.length !== 1 ? 's' : ''} to unlock your first Corridor rank.`;
    } else {
      routesEl.textContent = 'Corridor rankings active. Keep driving the same routes to move up.';
    }
  }

  renderCorridorCards();

  const drivesEl = document.getElementById('home-drives-count');
  if (drivesEl) drivesEl.textContent = all.length;

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

  // 7-day sparkline with trend headline and tappable dots
  const now   = Date.now();
  const week  = scored.filter(d => now - d.startTime < 7 * 86400000).slice(-7).reverse();
  const sparkLine  = document.getElementById('home-sparkline-line');
  const sparkDots  = document.getElementById('home-sparkline-dots');
  const trendEl    = document.getElementById('home-sparkline-trend');

  if (sparkLine) sparkLine.setAttribute('points', '');
  if (sparkDots) sparkDots.innerHTML = '';

  if (week.length > 1) {
    const vals = week.map(d => d.score);
    const min  = Math.min(...vals), max = Math.max(...vals);
    const rng  = max - min || 1;
    const coords = vals.map((v, i) => ({
      x: Math.round(i / (vals.length - 1) * 342),
      y: Math.round(44 - ((v - min) / rng) * 36),
      drive: week[i],
    }));

    if (sparkLine) sparkLine.setAttribute('points', coords.map(c => c.x + ',' + c.y).join(' '));

    if (sparkDots) {
      coords.forEach((c, i) => {
        const isLast = i === coords.length - 1;
        // Invisible hit-target circle
        const hit = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        hit.setAttribute('cx', c.x); hit.setAttribute('cy', c.y); hit.setAttribute('r', '14');
        hit.setAttribute('fill', 'transparent'); hit.style.cursor = 'pointer';
        hit.addEventListener('click', () => renderReview(c.drive));
        // Visible dot
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', c.x); dot.setAttribute('cy', c.y);
        dot.setAttribute('r', isLast ? '4' : '3');
        dot.setAttribute('fill', isLast ? '#E8501A' : 'rgba(242,232,213,0.5)');
        sparkDots.appendChild(dot);
        sparkDots.appendChild(hit);
      });
    }

    // Trend headline: compare first half avg to second half avg
    if (trendEl) {
      const mid   = Math.floor(vals.length / 2);
      const early = vals.slice(0, mid).reduce((s, v) => s + v, 0) / mid;
      const late  = vals.slice(mid).reduce((s, v) => s + v, 0) / (vals.length - mid);
      const delta = Math.round(late - early);
      const latest = vals[vals.length - 1];
      let arrow, verdict;
      if (delta >= 5)       { arrow = '↑'; verdict = delta >= 10 ? 'On a roll' : 'Trending up'; }
      else if (delta <= -5) { arrow = '↓'; verdict = delta <= -10 ? 'Time to refocus' : 'Room to improve'; }
      else                  { arrow = '→'; verdict = `Holding steady at ${latest}`; }
      trendEl.textContent = delta === 0 || Math.abs(delta) < 5
        ? verdict
        : `${arrow} ${delta > 0 ? '+' : ''}${delta} pts · ${verdict}`;
      trendEl.style.color = delta >= 5 ? 'rgba(90,158,82,.9)' : delta <= -5 ? 'rgba(224,59,47,.8)' : 'rgba(242,232,213,.4)';
    }
  } else if (trendEl) {
    trendEl.textContent = week.length === 1 ? `Score: ${week[0].score}` : 'Drive more to see your trend';
    trendEl.style.color = 'rgba(242,232,213,.3)';
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

function renderCorridorCards(){
  const host = document.getElementById('home-corridors-list');
  if (!host) return;
  const corridors = loadCorridors();

  if (!corridors.length){
    host.innerHTML = `
      <div class="hcl-empty">
        <div class="hcl-empty-title">Your first corridor</div>
        <div class="hcl-empty-sub">Drive a named road for 500m+ to unlock your corridor rank</div>
      </div>`;
    return;
  }

  const top = [...corridors]
    .sort((a, b) => b.drives.length - a.drives.length)
    .slice(0, 3);

  host.innerHTML = top.map(c => {
    const count    = c.drives.length;
    const avgScore = Math.round(c.drives.reduce((s, d) => s + d.score, 0) / count);
    return `
      <div class="hcl-card" data-corridor-id="${c.corridorId}">
        <div class="hcl-road-info">
          <div class="hcl-road-name">${c.name}</div>
          <div class="hcl-road-meta">${c.city} · ${count} drive${count !== 1 ? 's' : ''}</div>
        </div>
        <div class="hcl-scores">
          <div class="hcl-score-avg">${avgScore}</div>
          <div class="hcl-score-lbl">avg</div>
        </div>
      </div>`;
  }).join('');

  host.querySelectorAll('.hcl-card').forEach(card => {
    card.addEventListener('click', () => {
      import('./corridor.js').then(m => m.renderCorridor(card.dataset.corridorId));
    });
  });
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
