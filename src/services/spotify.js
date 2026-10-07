/**
 * Spotify — now-playing + transport controls for the driving screen.
 *
 * Auth is Authorization Code + PKCE (no secret ever ships in the app). The client ID
 * is public; until VITE_SPOTIFY_CLIENT_ID is set the whole feature stays inert and the
 * UI never shows a Spotify control. Playback controls need the user to have Premium
 * (Spotify's rule, not ours) — reads and saving a track work on free accounts.
 *
 * Everything network-facing takes `fetch` from globalThis so tests can mock it.
 */
export const SPOTIFY = {
  CLIENT_ID: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SPOTIFY_CLIENT_ID) || '',
  NATIVE_REDIRECT: 'com.smoothafdriving.app://spotify',
  SCOPES: 'user-read-playback-state user-modify-playback-state user-library-read user-library-modify',
  AUTH_URL: 'https://accounts.spotify.com/authorize',
  TOKEN_URL: 'https://accounts.spotify.com/api/token',
  API: 'https://api.spotify.com/v1',
  KEY_TOKENS: 'smoothaf.spotify_tokens',
  KEY_VERIFIER: 'smoothaf.spotify_verifier',
};

const store = () => globalThis.localStorage;
const read = (k) => { try { return JSON.parse(store().getItem(k)); } catch { return null; } };
const write = (k, v) => { try { v == null ? store().removeItem(k) : store().setItem(k, JSON.stringify(v)); } catch { /* best-effort */ } };

export const isConfigured = (id = SPOTIFY.CLIENT_ID) => Boolean(id);
export const isConnected = () => Boolean(read(SPOTIFY.KEY_TOKENS)?.refresh_token);
export const disconnect = () => { write(SPOTIFY.KEY_TOKENS, null); write(SPOTIFY.KEY_VERIFIER, null); };

export function redirectUri(native, origin = globalThis.location?.origin || ''){
  return native ? SPOTIFY.NATIVE_REDIRECT : `${origin}/`;
}

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function randomVerifier(){
  const a = new Uint8Array(48); globalThis.crypto.getRandomValues(a);
  return b64url(a);
}
export async function challengeFor(verifier){
  return b64url(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
}

/** The URL to send the driver to. Stashes the PKCE verifier for the return trip. */
export async function buildAuthUrl({ native = false, clientId = SPOTIFY.CLIENT_ID, origin } = {}){
  const verifier = randomVerifier();
  write(SPOTIFY.KEY_VERIFIER, { v: verifier, r: redirectUri(native, origin) });
  const q = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: redirectUri(native, origin),
    scope: SPOTIFY.SCOPES, code_challenge_method: 'S256', code_challenge: await challengeFor(verifier),
  });
  return `${SPOTIFY.AUTH_URL}?${q}`;
}

async function tokenCall(body){
  const res = await fetch(SPOTIFY.TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: SPOTIFY.CLIENT_ID, ...body }),
  });
  if (!res.ok) throw Object.assign(new Error('token'), { status: res.status });
  return res.json();
}
function saveTokens(t, prev){
  write(SPOTIFY.KEY_TOKENS, {
    access_token: t.access_token,
    refresh_token: t.refresh_token || prev?.refresh_token,   // refresh responses may omit it
    expires_at: Date.now() + (t.expires_in || 3600) * 1000 - 60_000,
  });
}

/** Finish sign-in from the redirect URL (`?code=…`). Returns true when connected. */
export async function handleRedirect(url){
  let u; try { u = new URL(url); } catch { return false; }
  const code = u.searchParams.get('code');
  const pending = read(SPOTIFY.KEY_VERIFIER);
  if (!code || !pending) return false;
  write(SPOTIFY.KEY_VERIFIER, null);
  try {
    saveTokens(await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: pending.r, code_verifier: pending.v }));
    return true;
  } catch { return false; }
}

async function accessToken(){
  const t = read(SPOTIFY.KEY_TOKENS);
  if (!t) return null;
  if (Date.now() < t.expires_at) return t.access_token;
  try {
    const n = await tokenCall({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
    saveTokens(n, t); return n.access_token;
  } catch (e) {
    if (e.status === 400 || e.status === 401) disconnect();   // revoked: ask to reconnect
    return null;
  }
}

/** Authenticated call. Returns { ok, status, data }; never throws. */
async function api(method, path, { query } = {}){
  const tok = await accessToken();
  if (!tok) return { ok: false, status: 401, data: null };
  const qs = query ? `?${new URLSearchParams(query)}` : '';
  try {
    const res = await fetch(`${SPOTIFY.API}${path}${qs}`, { method, headers: { Authorization: `Bearer ${tok}` } });
    let data = null;
    if (res.status === 200) { try { data = await res.json(); } catch { /* empty body */ } }
    if (res.status === 401) disconnect();
    return { ok: res.ok, status: res.status, data };
  } catch { return { ok: false, status: 0, data: null }; }
}

/** What's playing: null when nothing is, else a flat, UI-ready object. */
export function shapePlayback(d){
  const it = d?.item;
  if (!it || d.currently_playing_type === 'ad') return d?.currently_playing_type === 'ad' ? { ad: true, playing: Boolean(d.is_playing) } : null;
  const imgs = it.album?.images || it.images || [];
  const art = (imgs.find(i => i.width && i.width <= 100) || imgs[imgs.length - 1] || {}).url || '';
  return {
    id: it.id, uri: it.uri, isTrack: it.type === 'track',
    title: it.name || '', artist: (it.artists || []).map(a => a.name).join(', ') || it.show?.name || '',
    art, playing: Boolean(d.is_playing),
  };
}

export async function getPlayback(){
  const r = await api('GET', '/me/player', { query: { additional_types: 'track,episode' } });
  if (r.status === 204) return { state: 'idle' };
  if (!r.ok) return { state: r.status === 401 ? 'auth' : 'error' };
  const p = shapePlayback(r.data);
  return p ? { state: 'ok', ...p } : { state: 'idle' };
}

const mapErr = (r) => r.ok ? 'ok' : r.status === 403 ? 'premium' : r.status === 404 ? 'nodevice' : r.status === 401 ? 'auth' : 'error';
export const play = async () => mapErr(await api('PUT', '/me/player/play'));
export const pause = async () => mapErr(await api('PUT', '/me/player/pause'));
export const next = async () => mapErr(await api('POST', '/me/player/next'));

const trackUri = (id) => `spotify:track:${id}`;
export async function isSaved(id){
  let r = await api('GET', '/me/library/contains', { query: { uris: trackUri(id) } });
  if (r.status === 404) r = await api('GET', '/me/tracks/contains', { query: { ids: id } });   // older endpoint
  return r.ok && Array.isArray(r.data) ? Boolean(r.data[0]) : null;
}
export async function setSaved(id, saved){
  const m = saved ? 'PUT' : 'DELETE';
  let r = await api(m, '/me/library', { query: { uris: trackUri(id) } });
  if (r.status === 404) r = await api(m, '/me/tracks', { query: { ids: id } });
  return mapErr(r);
}
