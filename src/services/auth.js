import { AUTH_KEY, SB_URL, SB_ANON, DRIVER_NAME_KEY } from '../constants.js';

/**
 * Account layer, spoken directly to Supabase's GoTrue REST API.
 *
 * No SDK: the rest of this app talks to Supabase over plain fetch, and pulling
 * in @supabase/supabase-js for four endpoints would roughly double the bundle.
 *
 * The session is the app's only notion of identity. Before this existed the
 * "device ID" was a random UUID per install — it identified a phone, not a
 * person, so a new phone meant a new stranger. A session survives reinstalls
 * and carries the drive history with it.
 */

// ── Session storage ───────────────────────────────────────────────────────────

/** Trimmed session, or null. Never throws — a corrupt blob reads as signed-out. */
export function getSession(){
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return (s && s.access_token && s.user?.id) ? s : null;
  } catch { return null; }
}

export function saveSession(s){
  try { localStorage.setItem(AUTH_KEY, JSON.stringify(s)); } catch {}
}

export function clearSession(){
  try { localStorage.removeItem(AUTH_KEY); } catch {}
}

export function currentUser(){
  return getSession()?.user || null;
}

export function isSignedIn(){
  return !!currentUser();
}

/**
 * Keep only what the client needs. GoTrue returns a large user object; storing
 * all of it wastes the localStorage budget that GPS samples are already
 * competing for.
 */
export function trimSession(raw){
  if (!raw || !raw.access_token || !raw.user?.id) return null;
  return {
    access_token:  raw.access_token,
    refresh_token: raw.refresh_token || null,
    // GoTrue sends expires_in (seconds); expires_at (epoch seconds) only
    // sometimes. Derive it so refresh logic has one field to trust.
    expires_at:    raw.expires_at || Math.floor(Date.now() / 1000) + (raw.expires_in || 3600),
    user: {
      id:    raw.user.id,
      email: raw.user.email || null,
      name:  raw.user.user_metadata?.name || raw.user.user_metadata?.full_name || null,
    },
  };
}

// ── Transport ─────────────────────────────────────────────────────────────────

/**
 * POST to a GoTrue endpoint. Resolves to {ok, data, error} — never throws, so
 * every caller can render a message instead of guarding with try/catch.
 */
async function gotrue(path, body){
  try {
    const res = await fetch(`${SB_URL}/auth/v1/${path}`, {
      method:  'POST',
      headers: { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok){
      return { ok: false, error: data?.msg || data?.error_description || data?.error || `Request failed (${res.status})` };
    }
    return { ok: true, data: data || {} };
  } catch {
    return { ok: false, error: "Couldn't reach the server — check your connection." };
  }
}

// ── Email (one-time code) ─────────────────────────────────────────────────────

/**
 * Mail a 6-digit code. Uses OTP rather than a magic link deliberately: a link
 * has to round-trip through a deep link back into the native app, which breaks
 * whenever the mail client opens it in its own webview. A code the driver types
 * works everywhere.
 */
export async function sendEmailCode(email){
  const addr = String(email || '').trim().toLowerCase();
  if (!isValidEmail(addr)) return { ok: false, error: 'That email doesn’t look right.' };
  return gotrue('otp', { email: addr, create_user: true });
}

/** Exchange the mailed code for a session. */
export async function verifyEmailCode(email, code){
  const addr  = String(email || '').trim().toLowerCase();
  const token = String(code || '').trim();
  if (!token) return { ok: false, error: 'Enter the code from your email.' };
  const res = await gotrue('verify', { email: addr, token, type: 'email' });
  if (!res.ok) return res;
  const session = trimSession(res.data);
  if (!session) return { ok: false, error: 'Sign-in failed — try again.' };
  saveSession(session);
  return { ok: true, data: session };
}

/** Deliberately loose — the mail server is the real validator. */
export function isValidEmail(addr){
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(addr || '').trim());
}

// ── Sign in with Apple ────────────────────────────────────────────────────────

/**
 * Exchange an Apple identity token for a Supabase session.
 *
 * The token comes from the native ASAuthorization sheet (via the Capacitor
 * plugin) — this function only does the server half, so it is testable and
 * stays identical if the native bridge changes.
 *
 * Inert until the Apple provider is enabled in the Supabase dashboard; see
 * isAppleConfigured().
 */
export async function signInWithAppleToken(identityToken, nonce){
  if (!identityToken) return { ok: false, error: 'Apple sign-in was cancelled.' };
  const body = { provider: 'apple', id_token: identityToken };
  if (nonce) body.nonce = nonce;
  const res = await gotrue('token?grant_type=id_token', body);
  if (!res.ok) return res;
  const session = trimSession(res.data);
  if (!session) return { ok: false, error: 'Sign-in failed — try again.' };
  saveSession(session);
  return { ok: true, data: session };
}

/**
 * Whether the Apple provider is switched on for this project. Checked at
 * runtime rather than hardcoded so the button appears by itself the moment the
 * dashboard toggle flips — no app release needed.
 */
export async function isAppleConfigured(){
  try {
    const res = await fetch(`${SB_URL}/auth/v1/settings`, { headers: { apikey: SB_ANON } });
    if (!res.ok) return false;
    const s = await res.json();
    return !!s?.external?.apple;
  } catch { return false; }
}

// ── Refresh / sign out ────────────────────────────────────────────────────────

/**
 * Refresh the access token when it is within 60s of expiry. Returns the live
 * session, or null if the refresh failed (in which case the stored session is
 * cleared — a stale token is worse than being signed out, because every
 * subsequent request would 401 silently).
 */
export async function refreshIfNeeded(){
  const s = getSession();
  if (!s) return null;
  if (s.expires_at && s.expires_at - 60 > Math.floor(Date.now() / 1000)) return s;
  if (!s.refresh_token){ clearSession(); return null; }
  const res = await gotrue('token?grant_type=refresh_token', { refresh_token: s.refresh_token });
  if (!res.ok){
    // A network blip shouldn't sign the driver out — only a refused token does.
    if (/connection/i.test(res.error || '')) return s;
    clearSession();
    return null;
  }
  const next = trimSession(res.data);
  if (!next){ clearSession(); return null; }
  saveSession(next);
  return next;
}

export async function signOut(){
  const s = getSession();
  clearSession();
  if (!s) return;
  // Best-effort server-side revoke; the local session is already gone either way.
  try {
    await fetch(`${SB_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: SB_ANON, Authorization: `Bearer ${s.access_token}` },
    });
  } catch {}
}

// ── Request headers ───────────────────────────────────────────────────────────

/**
 * Headers for a PostgREST call: the user's token when signed in, the anon key
 * otherwise. Row-level security reads the JWT, so passing the user token is
 * what scopes a query to that user's rows.
 */
export function authHeaders(){
  const s = getSession();
  const token = s?.access_token || SB_ANON;
  return { apikey: SB_ANON, Authorization: `Bearer ${token}` };
}

/** Display name, preferring the locally chosen one. */
export function displayName(){
  try {
    const local = localStorage.getItem(DRIVER_NAME_KEY);
    if (local) return local;
  } catch {}
  const u = currentUser();
  return u?.name || u?.email?.split('@')[0] || '';
}
