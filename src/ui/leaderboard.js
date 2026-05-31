import { showScreen } from './router.js';
import { loadDriverName, saveDriverName, loadLifetimeScore } from '../services/storage.js';
import { fetchLeaderboard, syncToLeaderboard } from '../services/supabase.js';
import { getDeviceId } from '../services/storage.js';

export async function openLeaderboard(){
  showScreen('leaderboard');
  const myName = loadDriverName();
  const myScore = loadLifetimeScore();

  // Update "my" card
  document.getElementById('lb-my-name-display').textContent = myName || 'You';
  document.getElementById('lb-my-score-val').textContent = myName ? myScore : '--';
  document.getElementById('btn-set-driver-name').textContent = myName ? 'Edit name' : 'Set name';

  // Show join CTA if no name yet
  document.getElementById('lb-join-cta').style.display = myName ? 'none' : 'block';

  // Fetch rankings
  const list = document.getElementById('lb-list');
  list.innerHTML = '<div class="lb-empty">Loading…</div>';

  const rows = await fetchLeaderboard();
  if (!rows || rows.length === 0){
    list.innerHTML = '<div class="lb-empty">No scores yet — be the first!</div>';
    return;
  }

  let myRank = '--';
  list.innerHTML = rows.map((row, i) => {
    const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
    const isMe = myName && row.username === myName;
    if (isMe) myRank = '#' + (i + 1);
    return `<div class="lb-row${isMe ? ' lb-row--me' : ''}">
      <div class="lb-rank ${rankClass}">${i + 1}</div>
      <div class="lb-row-name">${row.username}</div>
      <div class="lb-row-score">${row.lifetime_score}</div>
    </div>`;
  }).join('');

  document.getElementById('lb-my-rank').textContent = myRank;
}

export function openSignupModal(onSave){
  const modal = document.getElementById('signup-modal');
  const input = document.getElementById('signup-name-input');
  input.value = loadDriverName();
  modal.style.display = 'flex';
  setTimeout(() => input.focus(), 100);

  const submit = document.getElementById('signup-submit-btn');
  const cancel = document.getElementById('signup-cancel-btn');

  const cleanup = () => { modal.style.display = 'none'; };
  const handleSave = () => {
    const name = input.value.trim();
    if (!name) return;
    saveDriverName(name);
    cleanup();
    if (onSave) onSave(name);
  };

  submit.onclick = handleSave;
  input.onkeydown = e => { if (e.key === 'Enter') handleSave(); };
  cancel.onclick = cleanup;
}
