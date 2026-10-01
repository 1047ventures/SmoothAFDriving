/**
 * Post-drive "share & save" card (Q4).
 *
 * Shown once, over the recap, to a signed-out driver. The order is deliberate,
 * straight from the customer-journey review: the ask lands *after* the value is
 * felt, and it leads with sharing — committing a little social capital makes the
 * sign-in that keeps it feel worth it, rather than a wall up front. It replaces
 * the old name+email prompt with the real share + Apple-auth flow.
 */

import { FIRST_CTA_KEY, NAME_PROMPTED_KEY, USER_EMAIL_KEY } from '../constants.js';
import { isSignedIn, currentUser, updateUserMetadata } from '../services/auth.js';
import { loadDriverName, loadDriverFirst, loadDriverLast, saveDriverIdentity, getDeviceId } from '../services/storage.js';
import { registerUser } from '../services/supabase.js';
import { shareCurrentDrive } from './share.js';
import { openAuthSheet, refreshAccountButton } from './auth.js';
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
/**
 * Post-drive prompt coordinator. Called after every finished drive — shows at
 * most one card, never stacks two. The share/sign-in CTA (signed-out, first
 * drive) takes priority; otherwise, if we still don't have a name for this
 * driver, ask for it. Both are once-only and skippable.
 */
export function runPostDrivePrompts(){
  if (showFirstDriveCTAIfNeeded()) return;
  showNamePromptIfNeeded();
}

export function showFirstDriveCTAIfNeeded(){
  if (isSignedIn()) return false;
  if (localStorage.getItem(FIRST_CTA_KEY)) return false;
  if (el('pdcta-overlay')) return false;
  const drive = reviewDrive;
  if (!drive || typeof drive.score !== 'number') return false;

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
  return true;
}

/**
 * "What's your name, Driver?" — a light first/last capture for anyone who
 * hasn't given a name yet (skipped sign-up, or signed in with Apple's relay
 * email and no name). Shown once, after a scored drive, and skippable. Saves
 * locally, writes through to the users table, and — when signed in — onto the
 * account itself so it follows the driver to any phone.
 */
export function showNamePromptIfNeeded(){
  if (loadDriverName()) return false;                     // already have a name
  if (localStorage.getItem(NAME_PROMPTED_KEY)) return false;
  if (el('pdcta-overlay') || el('np-overlay')) return false;
  const drive = reviewDrive;
  if (!drive || typeof drive.score !== 'number') return false;

  localStorage.setItem(NAME_PROMPTED_KEY, '1');           // strictly once

  const overlay = document.createElement('div');
  overlay.id = 'np-overlay';
  overlay.className = 'pdcta-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Add your name');
  overlay.innerHTML = `
    <div class="pdcta-card">
      <h2 class="pdcta-h">What's your name, Driver?</h2>
      <p class="pdcta-sub">So your smooth moves show up with a name, not a number.</p>
      <div class="pdcta-fields">
        <input id="np-first" class="pdcta-input" type="text" autocomplete="given-name"
               autocapitalize="words" placeholder="First name" value="${esc(loadDriverFirst())}">
        <input id="np-last" class="pdcta-input" type="text" autocomplete="family-name"
               autocapitalize="words" placeholder="Last name" value="${esc(loadDriverLast())}">
      </div>
      <button id="np-save" class="pdcta-primary" type="button">Save</button>
      <button id="np-skip" class="pdcta-skip" type="button">Not now</button>
    </div>`;
  document.body.appendChild(overlay);

  const closeNp = () => {
    overlay.classList.add('closing');
    setTimeout(() => overlay.remove(), 260);
  };

  const save = () => {
    const first = el('np-first').value.trim();
    const last  = el('np-last').value.trim();
    if (!first && !last) { closeNp(); return; }           // nothing entered = skip
    saveDriverIdentity(first, last);
    const name  = [first, last].filter(Boolean).join(' ');
    const email = (localStorage.getItem(USER_EMAIL_KEY) || currentUser()?.email || '').trim();
    // Write-through to the operator's users table (name-only is fine now).
    registerUser({ name, email, device_id: getDeviceId() });
    // And onto the account itself, so it survives to any device they sign in on.
    if (isSignedIn()) updateUserMetadata({ given_name: first, family_name: last, name });
    try { refreshAccountButton(); } catch {}
    closeNp();
  };

  el('np-save').addEventListener('click', save);
  el('np-skip').addEventListener('click', closeNp);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeNp(); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  setTimeout(() => el('np-first')?.focus(), 80);
  return true;
}

// Minimal HTML-attribute escape for the prefilled values.
function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
