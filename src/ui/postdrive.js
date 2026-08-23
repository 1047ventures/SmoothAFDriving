/**
 * Post-drive "share & save" card (Q4).
 *
 * Shown once, over the recap, to a signed-out driver. The order is deliberate,
 * straight from the customer-journey review: the ask lands *after* the value is
 * felt, and it leads with sharing — committing a little social capital makes the
 * sign-in that keeps it feel worth it, rather than a wall up front. It replaces
 * the old name+email prompt with the real share + Apple-auth flow.
 */

import { FIRST_CTA_KEY } from '../constants.js';
import { isSignedIn } from '../services/auth.js';
import { shareCurrentDrive } from './share.js';
import { openAuthSheet } from './auth.js';
import { reviewDrive, reviewAnalysis } from './review.js';

const el = id => document.getElementById(id);

function close(){
  const o = el('pdcta-overlay');
  if (!o) return;
  o.classList.add('closing');
  setTimeout(() => o.remove(), 260);
}

/**
 * Show the card if this is a good moment: a real scored drive just finished, the
 * driver isn't signed in, and they haven't seen this before. Anything else is a
 * no-op, so it's safe to call after every drive.
 */
export function showFirstDriveCTAIfNeeded(){
  if (isSignedIn()) return;
  if (localStorage.getItem(FIRST_CTA_KEY)) return;
  if (el('pdcta-overlay')) return;
  const drive = reviewDrive;
  if (!drive || typeof drive.score !== 'number') return;

  // Mark seen on show, so it's strictly once whether they act or dismiss.
  localStorage.setItem(FIRST_CTA_KEY, '1');

  const score = Math.round(drive.score);
  const overlay = document.createElement('div');
  overlay.id = 'pdcta-overlay';
  overlay.className = 'pdcta-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Share and save your drive');
  overlay.innerHTML = `
    <div class="pdcta-card">
      <div class="pdcta-score"><b>${score}</b><i>/100</i></div>
      <h2 class="pdcta-h">Nice one.</h2>
      <p class="pdcta-sub">Show your friends &mdash; then sign in to keep every drive, on any phone.</p>
      <button id="pdcta-share" class="pdcta-primary" type="button">Share this drive</button>
      <button id="pdcta-signin" class="pdcta-secondary" type="button">Sign in to save it</button>
      <button id="pdcta-skip" class="pdcta-skip" type="button">Not now</button>
    </div>`;
  document.body.appendChild(overlay);

  // Share leaves the card up — the OS share sheet floats over it, and when it
  // returns they can still sign in. That's the whole point of the ordering.
  el('pdcta-share').addEventListener('click', () => {
    try { shareCurrentDrive(reviewDrive, reviewAnalysis); } catch { /* share sheet declined */ }
  });
  el('pdcta-signin').addEventListener('click', () => { close(); openAuthSheet(); });
  el('pdcta-skip').addEventListener('click', close);
  // Tapping the dimmed backdrop dismisses, like every other sheet in the app.
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}
