import { loadDrives } from '../services/storage.js';
import { drivePoints } from '../services/points.js';

// Milestones are smooth-mile badges — honest achievements, nothing redeemable
// yet. Each label is what you become at that many smooth miles.
const MILESTONES = [
  { mi: 10,   label: 'Smooth Starter' },
  { mi: 50,   label: 'Rolling Clean' },
  { mi: 100,  label: 'Century Smooth' },
  { mi: 250,  label: 'Glass of Water' },
  { mi: 500,  label: 'Smooth Operator' },
  { mi: 1000, label: 'Smooth AF Legend' },
];

const fmtMi = mi => mi >= 100 ? Math.round(mi).toLocaleString() : mi.toFixed(1);

export function renderRewards(){
  const drives = loadDrives().filter(d => d.score != null);
  const per = drives.map(d => d.points ?? drivePoints(d));
  const points   = per.reduce((s, p) => s + p.total, 0);
  const smoothMi = per.reduce((s, p) => s + p.smoothMi, 0);
  const totalMi  = per.reduce((s, p) => s + p.totalMi, 0);
  const smoothPct = totalMi > 0 ? Math.round(smoothMi / totalMi * 100) : 0;

  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set('rw-points', points.toLocaleString());
  set('rw-smooth-mi', fmtMi(smoothMi));
  set('rw-smooth-pct', smoothPct + '%');

  // Next smooth-mile milestone
  const fillEl = document.getElementById('rw-progress-fill');
  const nextIdx = MILESTONES.findIndex(m => smoothMi < m.mi);
  if (nextIdx >= 0){
    const prev = nextIdx > 0 ? MILESTONES[nextIdx - 1].mi : 0;
    const next = MILESTONES[nextIdx];
    const pct  = Math.min(100, Math.round((smoothMi - prev) / (next.mi - prev) * 100));
    set('rw-closest-label', `${fmtMi(next.mi - smoothMi)} smooth mi to go`);
    set('rw-closest-reward', next.label);
    if (fillEl) fillEl.style.width = pct + '%';
  } else {
    set('rw-closest-label', 'Every milestone unlocked');
    set('rw-closest-reward', MILESTONES[MILESTONES.length - 1].label);
    if (fillEl) fillEl.style.width = '100%';
  }

  // Recent drives — what each one banked
  const actList = document.getElementById('rw-activity-list');
  if (actList){
    const recent = drives.slice(0, 8);
    actList.innerHTML = recent.length ? recent.map((d, i) => {
      const p = per[i];
      const when = new Date(d.startTime);
      const bonus = p.bonus > 0 ? ` · +${p.bonus} on-time bonus` : '';
      return `<div class="rw-activity-row">
        <div>
          <div class="rw-activity-main">${when.toLocaleDateString([], {weekday:'short', month:'short', day:'numeric'})}</div>
          <div class="rw-activity-sub">${p.smoothMi.toFixed(1)} of ${p.totalMi.toFixed(1)} mi smooth${bonus}</div>
        </div>
        <div class="rw-activity-pts rw-earned">+${p.total}</div>
      </div>`;
    }).join('')
    : '<div class="rw-activity-sub" style="padding:16px 0">Your first smooth mile earns 10 points.</div>';
  }
}
