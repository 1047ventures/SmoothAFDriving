import { APP_VERSION, REMOVEBG_KEY } from './constants.js';
import { migrateLifetimeScore } from './services/storage.js';
import { checkRecoveredDrive } from './services/drive.js';
import { syncPendingDrives } from './services/supabase.js';
import { renderDriveList } from './ui/home.js';
import { renderCarDisplay, renderRecAvatar, saveRecPhoto, showGarageSheet, hideGarageSheet, processCarPhoto, wireGarageButtons } from './ui/garage.js';
import { showScreen } from './ui/router.js';
import { wireStartButton, stopRecording, startSimulatedDrive } from './ui/record.js';
import { renderRewards } from './ui/rewards.js';
import { openLeaderboard, openSignupModal, switchLeaderboardTab } from './ui/leaderboard.js';
import { enterMapFilter, clearMapFilter, renderReview } from './ui/review.js';
import { metersToMiles } from './utils/math.js';
import { state } from './state.js';

// Export key init functions for DOMContentLoaded (wired below)
export { migrateLifetimeScore, renderDriveList, renderCarDisplay };

document.addEventListener('DOMContentLoaded', () => {
  migrateLifetimeScore();
  checkRecoveredDrive({ onListUpdate: renderDriveList });
  renderDriveList();
  syncPendingDrives();
  renderCarDisplay();
  const verEl = document.querySelector('#app-version');
  if (verEl) verEl.textContent = APP_VERSION;

  // Re-acquire wake lock whenever app returns to foreground during a drive
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.recording && 'wakeLock' in navigator){
      navigator.wakeLock.request('screen')
        .then(wl => { state.wakeLock = wl; })
        .catch(() => {});
    }
  });

  wireStartButton('#btn-start');
  wireStartButton('#btn-new-drive');

  document.querySelector('#btn-stop')?.addEventListener('click', () => stopRecording());

  document.querySelector('#btn-back')?.addEventListener('click', () => {
    const mapBlock = document.querySelector('.review-map-block');
    if (mapBlock && mapBlock.classList.contains('map-full')) {
      mapBlock.classList.remove('map-full');
      clearMapFilter();
      const expandBtn = document.getElementById('btn-map-expand');
      if (expandBtn) { expandBtn.textContent = '⤢'; expandBtn.setAttribute('aria-label', 'Expand map'); }
      // mapInstance invalidation handled in review.js
      return;
    }
    showScreen('home');
    renderDriveList();
  });

  document.getElementById('btn-map-expand')?.addEventListener('click', () => {
    const mapBlock = document.querySelector('.review-map-block');
    const btn = document.getElementById('btn-map-expand');
    const isFull = mapBlock.classList.toggle('map-full');
    btn.textContent = isFull ? '×' : '⤢';
    btn.setAttribute('aria-label', isFull ? 'Close map' : 'Expand map');
    if (!isFull) clearMapFilter();
    // Map resize handled in review.js invalidateSize
  });

  document.getElementById('map-filter-clear')?.addEventListener('click', clearMapFilter);

  document.querySelectorAll('.event-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const type = chip.classList.contains('brake') ? 'brake'
                 : chip.classList.contains('accel') ? 'accel'
                 : chip.classList.contains('stop')  ? 'stop' : 'turn';
      enterMapFilter(type);
    });
  });

  // Remove.bg API key modal
  document.getElementById('removebg-save')?.addEventListener('click', () => {
    const key = document.getElementById('removebg-key-input').value.trim();
    if (!key) return;
    localStorage.setItem(REMOVEBG_KEY, key);
    document.getElementById('removebg-modal').classList.add('hidden');
    const f = document.getElementById('removebg-modal')._pendingFile;
    if (f) processCarPhoto(f);
  });
  document.getElementById('removebg-skip')?.addEventListener('click', () => {
    const modal = document.getElementById('removebg-modal');
    modal.classList.add('hidden');
    const f = modal._pendingFile;
    // Plain photo save — skip remove.bg, processCarPhoto handles the fallback internally
    if (f) processCarPhoto(f);
  });

  // Recording screen background upload
  document.getElementById('rec-photo-input')?.addEventListener('change', e => {
    if (e.target.files[0]) saveRecPhoto(e.target.files[0]);
  });
  document.getElementById('btn-go-home')?.addEventListener('click', () => {
    showScreen('home');
    renderDriveList();
  });

  // Leaderboard / Rivals
  document.getElementById('btn-rivals')?.addEventListener('click', () => openLeaderboard('rivals'));
  document.getElementById('btn-leaderboard')?.addEventListener('click', () => openLeaderboard('overall'));
  document.getElementById('btn-lb-back')?.addEventListener('click', () => { showScreen('home'); renderDriveList(); });
  document.getElementById('btn-set-driver-name')?.addEventListener('click', () => openSignupModal(() => openLeaderboard()));
  document.getElementById('btn-join-lb')?.addEventListener('click', () => openSignupModal(() => openLeaderboard()));
  document.getElementById('btn-join-rivals')?.addEventListener('click', () => openSignupModal(() => openLeaderboard('rivals')));

  // Leaderboard tabs — functional switching
  document.querySelectorAll('.lb-tab').forEach(tab => {
    tab.addEventListener('click', () => switchLeaderboardTab(tab.dataset.tab));
  });

  // Rewards
  document.getElementById('btn-rewards')?.addEventListener('click', () => { renderRewards(); showScreen('rewards'); });
  document.getElementById('btn-rw-back')?.addEventListener('click', () => { showScreen('home'); renderDriveList(); });
  document.getElementById('btn-rw-explore')?.addEventListener('click', () => {
    if (navigator.share) navigator.share({ title: 'Smooth AF', text: 'Check out Smooth AF — the driving score app!' }).catch(() => {});
  });

  // Share drive button — uses module-level reviewDrive from review.js
  document.getElementById('btn-share-drive')?.addEventListener('click', async () => {
    const { reviewDrive: rd } = await import('./ui/review.js');
    if (navigator.share && rd){
      const mi = metersToMiles(rd.distanceMeters || 0).toFixed(1);
      navigator.share({ title: 'Smooth AF Drive', text: `I scored ${rd.score}/100 on a ${mi} mi drive!` }).catch(() => {});
    }
  });

  // Garage sheet
  wireGarageButtons();

  // Past drives toggle
  document.getElementById('btn-view-drives')?.addEventListener('click', () => {
    const panel = document.getElementById('drives-list-panel');
    const btn = document.getElementById('btn-view-drives');
    const opening = !panel.classList.contains('open');
    panel.classList.toggle('open', opening);
    btn.textContent = opening ? 'Hide drives' : 'Past drives';
  });

  // Register service worker
  if ('serviceWorker' in navigator){
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
});
