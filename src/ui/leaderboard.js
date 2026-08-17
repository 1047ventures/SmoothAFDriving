import { showScreen } from './router.js';
import { loadDriverName, saveDriverName, loadLifetimeScore } from '../services/storage.js';
import { fetchLeaderboard, syncToLeaderboard } from '../services/supabase.js';
import { getDeviceId } from '../services/storage.js';

// The ghost rows that used to live here — SilkySmith, CoastMaster and friends —
// were invented names with invented scores, shown whenever the real board came
// back empty. Harmless as set dressing for a demo; dishonest the moment a
// ranking is tied to a fuel discount, and indistinguishable from real
// competitors to anyone looking at the screen. An empty board that says it is
// empty is worth more than a full one that is fiction.

export async function openLeaderboard(tab = 'overall'){
  showScreen('leaderboard');

  // Switch to requested tab
  switchLeaderboardTab(tab);

  const myName  = loadDriverName();
  const myScore = loadLifetimeScore();

  // Update "my" card
  const nameDisplay = document.getElementById('lb-my-name-display');
  const scoreVal    = document.getElementById('lb-my-score-val');
  const setNameBtn  = document.getElementById('btn-set-driver-name');
  if (nameDisplay) nameDisplay.textContent = myName || 'You';
  if (scoreVal)    scoreVal.textContent    = myName ? Math.round(myScore) : '--';
  if (setNameBtn)  setNameBtn.textContent  = myName ? 'Edit name' : 'Set name';

  // Show/hide join CTAs
  const joinCta = document.getElementById('lb-join-cta');
  if (joinCta) joinCta.style.display = myName ? 'none' : 'block';
  const rivalsCta = document.getElementById('lb-rivals-join-cta');
  if (rivalsCta) rivalsCta.style.display = myName ? 'none' : 'block';

  // Fetch live rankings, fall back to ghost rows
  const list = document.getElementById('lb-list');
  if (list) list.innerHTML = '<div class="lb-empty">Loading…</div>';

  let rows;
  try {
    rows = await fetchLeaderboard();
  } catch {
    rows = null;
  }

  let myRank = '--';
  if (list) {
    if (!rows) {
      // Distinguish "couldn't ask" from "nobody qualifies yet" — one is a
      // network blip worth retrying, the other is the true state of the board.
      list.innerHTML = '<div class="lb-empty">Couldn\u2019t load the leaderboard \u2014 check your connection.</div>';
    } else if (rows.length === 0) {
      list.innerHTML = '<div class="lb-empty">No ranked drivers yet.<br>'
                     + 'Three scored drives puts you on the board.</div>';
    } else {
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
    }
  }

  const myRankEl = document.getElementById('lb-my-rank');
  if (myRankEl) myRankEl.textContent = myRank;
}

export function switchLeaderboardTab(tabName){
  document.querySelectorAll('.lb-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabName);
  });
  document.querySelectorAll('[data-lb-content]').forEach(el => {
    el.style.display = el.dataset.lbContent === tabName ? 'block' : 'none';
  });
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
