import {
  isSignedIn, currentUser, displayName, sendEmailCode, verifyEmailCode,
  signOut, isAppleConfigured, signInWithAppleToken,
} from '../services/auth.js';
import { restoreDrivesForUser } from '../services/drive.js';
import { renderDriveList } from './home.js';

/**
 * Account sheet: email one-time-code sign-in, with the Apple button appearing
 * on its own once the provider is enabled server-side.
 */

const el = id => document.getElementById(id);

/** Email typed in step 1, needed again to verify the code in step 2. */
let pendingEmail = '';

function show(id, on){
  el(id)?.classList.toggle('hidden', !on);
}

/**
 * Swap the card header between the two steps. On the code step the pitch
 * ("Save your drives / …follow you to any phone") is spent — the driver has
 * already decided — and it competed with the "Code sent to …" line for the same
 * job. Tell them what to do instead.
 */
function setStep(step){
  const onCode = step === 'code';
  show('auth-step-email', !onCode);
  show('auth-step-code',   onCode);
  const title = el('auth-title');
  const sub   = el('auth-sub');
  if (title) title.textContent = onCode ? 'Check your email' : 'Save your drives';
  if (sub){
    sub.textContent = onCode
      ? 'Enter the 6-digit code we just sent.'
      : 'Sign in so your score and history follow you to any phone.';
  }
}

function setStatus(text, isError){
  const s = el(isSignedIn() ? 'auth-status-in' : 'auth-status');
  if (!s) return;
  s.textContent = text || '';
  s.classList.toggle('is-error', !!isError);
}

/** Reflect the current session in the sheet's two panes. */
function renderSheet(){
  const signed = isSignedIn();
  show('auth-signedout', !signed);
  show('auth-signedin', signed);
  if (signed){
    const u = currentUser();
    const label = u?.email || u?.name || 'Your account';
    const who = el('auth-who');
    if (who) who.textContent = label;
    // Seed the avatar with the driver's initial — a name's first letter when we
    // have one, otherwise the email's, falling back to a dot so the circle is
    // never blank.
    const avatar = el('auth-avatar');
    if (avatar){
      const src = displayName() || u?.email || '';
      avatar.textContent = (src.trim()[0] || '•').toUpperCase();
    }
  } else {
    // Always reopen on step 1 — a half-finished code entry from a previous
    // visit is stale, since the mailed code expires.
    setStep('email');
  }
  setStatus('');
}

export function openAuthSheet(){
  renderSheet();
  el('auth-sheet')?.classList.remove('hidden');
  maybeShowAppleButton();
}

export function closeAuthSheet(){
  el('auth-sheet')?.classList.add('hidden');
}

/**
 * Reveal the Apple button only when the provider is actually enabled. Showing a
 * button that always errors is worse than not showing one.
 */
async function maybeShowAppleButton(){
  const btn = el('auth-apple-btn');
  if (!btn || isSignedIn()) return;
  if (await isAppleConfigured()){
    btn.classList.remove('hidden');
    // The "or" divider only makes sense once there are two methods on screen.
    el('auth-or')?.classList.remove('hidden');
  }
}

/** Home top-bar label: the driver's name when known, "Sign in" otherwise. */
export function refreshAccountButton(){
  const btn = el('btn-account');
  if (!btn) return;
  if (isSignedIn()){
    const name = displayName();
    btn.textContent = name ? name.split(' ')[0].slice(0, 12) : 'Account';
    btn.classList.add('is-signed-in');
  } else {
    btn.textContent = 'Sign in';
    btn.classList.remove('is-signed-in');
  }
}

/**
 * After a successful sign-in: pull the account's history down, then refresh
 * every surface that shows a name or a drive count.
 */
async function afterSignIn(){
  renderSheet();
  refreshAccountButton();
  setStatus('Syncing your drives…');
  const result = await restoreDrivesForUser();
  if (!result){
    setStatus("Signed in, but couldn't sync drives — tap Sync to retry.", true);
    return;
  }
  setStatus(result.added > 0
    ? `Signed in. Restored ${result.added} drive${result.added === 1 ? '' : 's'}.`
    : 'Signed in. Everything is up to date.');
  renderDriveList();
}

export function initAuthUI(){
  const btn = el('btn-account');
  if (btn) btn.addEventListener('click', openAuthSheet);
  refreshAccountButton();

  el('auth-close')?.addEventListener('click', closeAuthSheet);
  el('auth-sheet')?.addEventListener('click', e => {
    if (e.target === el('auth-sheet')) closeAuthSheet();
  });

  // Step 1 — mail the code.
  el('auth-email-btn')?.addEventListener('click', async () => {
    const input = el('auth-email');
    const go    = el('auth-email-btn');
    if (!input || !go) return;
    go.disabled = true;
    setStatus('Sending…');
    const res = await sendEmailCode(input.value);
    go.disabled = false;
    if (!res.ok){ setStatus(res.error, true); return; }
    pendingEmail = input.value.trim().toLowerCase();
    const sent = el('auth-sent');
    if (sent) sent.textContent = `Code sent to ${pendingEmail}`;
    setStep('code');
    setStatus('');
    el('auth-code')?.focus();
  });

  // Step 2 — exchange the code for a session.
  el('auth-code-btn')?.addEventListener('click', async () => {
    const input = el('auth-code');
    const go    = el('auth-code-btn');
    if (!input || !go) return;
    go.disabled = true;
    setStatus('Verifying…');
    const res = await verifyEmailCode(pendingEmail, input.value);
    go.disabled = false;
    if (!res.ok){ setStatus(res.error, true); return; }
    input.value = '';
    await afterSignIn();
  });

  el('auth-back')?.addEventListener('click', () => {
    setStep('email');
    setStatus('');
  });

  // Resend the code to the same address — the mailed code expires, so a driver
  // who was slow to switch apps needs a way to get a fresh one without retyping
  // their email.
  el('auth-resend')?.addEventListener('click', async () => {
    const go = el('auth-resend');
    if (!pendingEmail || !go) return;
    go.disabled = true;
    setStatus('Sending a new code…');
    const res = await sendEmailCode(pendingEmail);
    go.disabled = false;
    if (!res.ok){ setStatus(res.error, true); return; }
    setStatus('New code sent — check your email.');
    el('auth-code')?.focus();
  });

  el('auth-apple-btn')?.addEventListener('click', async () => {
    setStatus('Opening Apple…');
    const cred = await requestAppleCredential();
    if (!cred){
      setStatus('Apple sign-in isn’t available on this device yet.', true);
      return;
    }
    const res = await signInWithAppleToken(cred.identityToken, cred.nonce);
    if (!res.ok){ setStatus(res.error, true); return; }
    await afterSignIn();
  });

  // Manual retry for the case where sign-in worked but the sync call didn't.
  el('auth-sync-btn')?.addEventListener('click', async () => {
    const go = el('auth-sync-btn');
    if (go) go.disabled = true;
    setStatus('Syncing…');
    const result = await restoreDrivesForUser();
    if (go) go.disabled = false;
    if (!result){ setStatus("Couldn't reach the cloud — try again.", true); return; }
    setStatus(result.added > 0
      ? `Restored ${result.added} drive${result.added === 1 ? '' : 's'}.`
      : 'Everything is up to date.');
    renderDriveList();
  });

  el('auth-signout')?.addEventListener('click', async () => {
    await signOut();
    // Local drives stay put on purpose — signing out shouldn't wipe the phone.
    renderSheet();
    refreshAccountButton();
  });
}

/**
 * Ask the native layer for an Apple credential.
 *
 * Returns null when the plugin isn't present — which is every web build, and
 * any native build made before the Sign In with Apple capability is added. The
 * caller treats null as "not available" rather than as a failure.
 */
async function requestAppleCredential(){
  const plugin = globalThis.Capacitor?.Plugins?.SignInWithApple;
  if (!plugin?.authorize) return null;
  try {
    const res = await plugin.authorize({ scopes: 'email name' });
    const token = res?.response?.identityToken;
    return token ? { identityToken: token, nonce: res?.response?.nonce } : null;
  } catch {
    return null;
  }
}
