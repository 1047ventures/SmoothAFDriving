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
import { enterMapFilter, clearMapFilter, renderReview, fitRouteToMap, reviewDrive, reviewAnalysis } from './ui/review.js';
import { shareCurrentDrive } from './ui/share.js';
import { state } from './state.js';
import { syncUserProfile } from './services/supabase.js';

// Export key init functions for DOMContentLoaded (wired below)
export { migrateLifetimeScore, renderDriveList, renderCarDisplay };

document.addEventListener('DOMContentLoaded', () => {
  // Show ad landing splash for first-time visitors arriving from ads
  const urlParams = new URLSearchParams(location.search);
  const utmSource = urlParams.get('utm_source');
  const isFirstVisit = !localStorage.getItem('smoothaf_visited');
  if (utmSource && isFirstVisit) {
    const splash = document.getElementById('ad-splash');
    if (splash) {
      splash.classList.remove('hidden');
      // Show iOS install hint on Safari (not already installed as PWA)
      const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const isStandalone = ('standalone' in navigator && navigator.standalone) || window.matchMedia('(display-mode: standalone)').matches;
      if (isIOS && !isStandalone) {
        document.getElementById('ad-splash-install')?.style.setProperty('display', 'block');
      }
      const dismiss = () => {
        splash.classList.add('hidden');
        localStorage.setItem('smoothaf_visited', '1');
      };
      document.getElementById('ad-splash-cta')?.addEventListener('click', dismiss);
      document.getElementById('ad-splash-skip')?.addEventListener('click', dismiss);
    }
  } else {
    localStorage.setItem('smoothaf_visited', '1');
  }

  migrateLifetimeScore();
  checkRecoveredDrive({ onListUpdate: renderDriveList });
  renderDriveList();
  syncPendingDrives();
  syncUserProfile();
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
    if (!isFull) { clearMapFilter(); return; }
    // Expanding: give CSS transition a frame then refit the full route
    setTimeout(fitRouteToMap, 120);
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

  // Share drive button
  document.getElementById('btn-share-drive')?.addEventListener('click', () => {
    shareCurrentDrive(reviewDrive, reviewAnalysis);
  });

  // Lifetime analysis sheet
  document.getElementById('lifetime-close')?.addEventListener('click', () => {
    document.getElementById('lifetime-sheet')?.classList.add('hidden');
  });

  // Corridor detail back
  document.getElementById('btn-corridor-back')?.addEventListener('click', () => {
    showScreen('home');
  });

  // Garage sheet
  wireGarageButtons();

  // Swipe from left edge to go back
  let swipeStartX = 0, swipeStartY = 0;
  document.addEventListener('touchstart', e => {
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - swipeStartX;
    const dy = Math.abs(e.changedTouches[0].clientY - swipeStartY);
    if (swipeStartX > 30 || dx < 60 || dy > dx * 0.8) return;
    const active = document.querySelector('.screen.active');
    if (!active || active.id === 'screen-home' || active.id === 'screen-record') return;
    const backBtnId = {
      'screen-review':      'btn-back',
      'screen-corridor':    'btn-corridor-back',
      'screen-leaderboard': 'btn-lb-back',
      'screen-rewards':     'btn-rw-back',
    }[active.id];
    const btn = backBtnId ? document.getElementById(backBtnId) : null;
    if (btn) btn.click();
    else { showScreen('home'); renderDriveList(); }
  }, { passive: true });

  // Register service worker
  if ('serviceWorker' in navigator){
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
});
