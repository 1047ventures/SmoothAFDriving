import { loadDrives } from '../services/storage.js';
import { metersToMiles } from '../utils/math.js';

export function renderRewards(){
  const drives = loadDrives().filter(d => d.score != null);
  const earned  = drives.reduce((s, d) => s + (d.score || 0), 0);
  const spent   = 0;
  const balance = earned - spent;

  const earnEl = document.getElementById('rw-earned');
  const spntEl = document.getElementById('rw-spent');
  const balEl  = document.getElementById('rw-balance');
  if (earnEl)  earnEl.textContent  = earned.toLocaleString();
  if (spntEl)  spntEl.textContent  = spent.toLocaleString();
  if (balEl)   balEl.textContent   = balance.toLocaleString();

  // Next reward milestone
  const MILESTONES = [100, 250, 500, 1000, 2500, 5000];
  const LABELS     = ['Smooth Starter Badge', 'First Reward Unlock', 'Car Wash Voucher', 'Oil Change Coupon', 'Premium Badge', 'Gas Tank Reward'];
  const nextIdx    = MILESTONES.findIndex(m => earned < m);
  const labelEl    = document.getElementById('rw-closest-label');
  const rewardEl   = document.getElementById('rw-closest-reward');
  const fillEl     = document.getElementById('rw-progress-fill');
  if (nextIdx >= 0){
    const prev = nextIdx > 0 ? MILESTONES[nextIdx - 1] : 0;
    const next = MILESTONES[nextIdx];
    const pct  = Math.min(100, Math.round((earned - prev) / (next - prev) * 100));
    if (labelEl)  labelEl.textContent  = `${next - earned} pts from your next reward`;
    if (rewardEl) rewardEl.textContent = LABELS[nextIdx];
    if (fillEl)   fillEl.style.width   = pct + '%';
  } else {
    if (labelEl)  labelEl.textContent  = 'All milestones unlocked!';
    if (rewardEl) rewardEl.textContent = 'Legendary Driver';
    if (fillEl)   fillEl.style.width   = '100%';
  }

  // Recent activity — last 5 drives
  const actList = document.getElementById('rw-activity-list');
  if (actList){
    const recent = drives.slice(0, 5);
    actList.innerHTML = recent.length ? recent.map(d => {
      const when = new Date(d.startTime);
      const pts  = d.score || 0;
      return `<div class="rw-activity-row">
        <div>
          <div class="rw-activity-main">${when.toLocaleDateString([], {weekday:'short', month:'short', day:'numeric'})}</div>
          <div class="rw-activity-sub">${metersToMiles(d.distanceMeters || 0).toFixed(1)} mi · Score ${d.score}</div>
        </div>
        <div class="rw-activity-pts rw-earned">+${pts}</div>
      </div>`;
    }).join('')
    : '<div style="padding:16px 0;font-size:13px;color:rgba(242,232,213,.35)">No drives yet</div>';
  }

  // Drive history rows — last 3
  const histList = document.getElementById('rw-history-list');
  if (histList){
    const recent = drives.slice(0, 3);
    histList.innerHTML = recent.map(d => {
      const when = new Date(d.startTime);
      return `<div class="rw-history-row">
        <div class="rw-history-date">${when.toLocaleDateString([], {weekday:'short', month:'short', day:'numeric'})} · ${metersToMiles(d.distanceMeters || 0).toFixed(1)} mi</div>
        <div class="rw-history-score">${d.score}</div>
        <div class="rw-history-pts">+${d.score} pts</div>
      </div>`;
    }).join('');
  }
}
