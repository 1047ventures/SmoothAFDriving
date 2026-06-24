import { loadCorridors } from '../services/storage.js';
import { showScreen } from './router.js';
import { metersToMiles } from '../utils/math.js';

export function renderCorridor(corridorId){
  const all      = loadCorridors();
  const corridor = all.find(c => c.corridorId === corridorId);
  if (!corridor){ showScreen('home'); return; }

  showScreen('corridor');

  const nameEl = document.getElementById('corridor-road-name');
  const cityEl = document.getElementById('corridor-city');
  if (nameEl) nameEl.textContent = corridor.name;
  if (cityEl) cityEl.textContent = corridor.city;

  const drives    = corridor.drives;
  const avgScore  = Math.round(drives.reduce((s, d) => s + d.score, 0) / drives.length);
  const bestScore = Math.max(...drives.map(d => d.score));

  const drivesEl = document.getElementById('corridor-drives');
  const avgEl    = document.getElementById('corridor-avg');
  const bestEl   = document.getElementById('corridor-best');
  if (drivesEl) drivesEl.textContent = drives.length;
  if (avgEl)    avgEl.textContent    = avgScore;
  if (bestEl)   bestEl.textContent   = bestScore;

  // Sparkline (last 7 drives, oldest first)
  const recent    = drives.slice(-7);
  const sparkLine = document.getElementById('corridor-sparkline-line');
  const sparkDots = document.getElementById('corridor-sparkline-dots');
  const trendEl   = document.getElementById('corridor-trend');

  if (sparkLine) sparkLine.setAttribute('points', '');
  if (sparkDots) sparkDots.innerHTML = '';

  if (recent.length > 1){
    const vals = recent.map(d => d.score);
    const min  = Math.min(...vals), max = Math.max(...vals);
    const rng  = max - min || 1;
    const coords = vals.map((v, i) => ({
      x: Math.round(i / (vals.length - 1) * 342),
      y: Math.round(44 - ((v - min) / rng) * 36),
    }));
    if (sparkLine) sparkLine.setAttribute('points', coords.map(c => `${c.x},${c.y}`).join(' '));
    if (sparkDots){
      coords.forEach((c, i) => {
        const isLast = i === coords.length - 1;
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', c.x); dot.setAttribute('cy', c.y);
        dot.setAttribute('r', isLast ? '4' : '3');
        dot.setAttribute('fill', isLast ? '#E8501A' : 'rgba(242,232,213,0.5)');
        sparkDots.appendChild(dot);
      });
    }
    if (trendEl){
      const mid   = Math.floor(vals.length / 2);
      const early = vals.slice(0, mid).reduce((s, v) => s + v, 0) / mid;
      const late  = vals.slice(mid).reduce((s, v) => s + v, 0) / (vals.length - mid);
      const delta = Math.round(late - early);
      trendEl.textContent = Math.abs(delta) < 5
        ? `Holding steady at ${vals[vals.length - 1]}`
        : `${delta > 0 ? '↑' : '↓'} ${delta > 0 ? '+' : ''}${delta} pts`;
      trendEl.style.color = delta >= 5 ? 'rgba(90,158,82,.9)' : delta <= -5 ? 'rgba(224,59,47,.8)' : 'rgba(242,232,213,.4)';
    }
  }

  // Drive history list (newest first)
  const listEl = document.getElementById('corridor-drives-list');
  if (listEl){
    listEl.innerHTML = [...drives].reverse().map(d => {
      const when = new Date(d.drivenAt);
      const mi   = metersToMiles(d.distanceMeters).toFixed(1);
      return `
        <div class="corridor-drive-row">
          <div class="corridor-drive-score">${d.score}</div>
          <div class="corridor-drive-meta">
            <div class="corridor-drive-date">${when.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</div>
            <div class="corridor-drive-dist">${mi} mi</div>
          </div>
        </div>`;
    }).join('');
  }
}
