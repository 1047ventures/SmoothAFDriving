/**
 * Profile sync — the things that belong to *you*, not to a handset.
 *
 * The garage lived only in localStorage, so signing in on a new phone brought
 * your drives and left your cars behind. Identity is the account now; a device
 * is just somewhere you happen to be signed in.
 *
 * Shape of the contract:
 *   - Signed out, everything still works, locally, exactly as before. This is
 *     additive; nothing here is allowed to become a precondition for driving.
 *   - On sign-in we MERGE rather than overwrite. A cold device pulls the
 *     account's garage; a device holding cars the account has never seen pushes
 *     them up. Whoever "wins" a straight overwrite, someone loses a vehicle
 *     they typed in by hand.
 */

import { SB_URL, SB_ANON, GARAGE_KEY, SOCIAL_HANDLES_KEY,
         CAR_POS_KEY, REC_POS_KEY, ONBOARDED_KEY,
         CAR_PROMPTED_KEY, SHARE_PROMPTED_KEY } from '../constants.js';
import { getSession } from './auth.js';

const ENDPOINT = `${SB_URL}/rest/v1/profiles`;

/** Authorized headers, or null when signed out — callers treat that as "skip". */
function authHeaders(){
  const session = getSession();
  const token   = session?.access_token;
  if (!token) return null;
  return {
    apikey:          SB_ANON,
    Authorization:   `Bearer ${token}`,
    'Content-Type':  'application/json',
  };
}

const readLocal  = (key, fallback) => {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
  catch { return fallback; }
};
const writeLocal = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
};

/**
 * Merge two garages by vehicle id, newest-wins per vehicle.
 *
 * Exported because this is the part worth testing directly: it is the only
 * place a user's hand-entered car can be destroyed, and the failure is silent.
 */
export function mergeGarages(local = [], remote = []){
  const byId = new Map();
  for (const v of [...remote, ...local]){
    if (!v || !v.id) continue;
    const existing = byId.get(v.id);
    if (!existing){ byId.set(v.id, v); continue; }
    // No updated_at on older records — treat a missing stamp as oldest so a
    // record that *does* carry one is preferred rather than coin-flipped.
    const a = Date.parse(existing.updated_at || '') || 0;
    const b = Date.parse(v.updated_at || '')        || 0;
    if (b >= a) byId.set(v.id, v);
  }
  const merged = [...byId.values()];

  // Exactly one active vehicle, always. Two devices each marking a different
  // car active would otherwise produce a garage with two, and the UI picks
  // whichever sorts first — a bug that looks like the app forgetting.
  const active = merged.filter(v => v.active);
  if (active.length > 1) merged.forEach(v => { v.active = v === active[0]; });
  if (active.length === 0 && merged.length) merged[0].active = true;

  return merged;
}

/** Everything on this device that belongs to the account. */
function collectLocal(){
  return {
    garage:         readLocal(GARAGE_KEY, []),
    social:         readLocal(SOCIAL_HANDLES_KEY, {}),
    car_pos:        readLocal(CAR_POS_KEY, null),
    rec_pos:        readLocal(REC_POS_KEY, null),
    onboarded:      localStorage.getItem(ONBOARDED_KEY)      === '1',
    car_prompted:   localStorage.getItem(CAR_PROMPTED_KEY)   === '1',
    share_prompted: localStorage.getItem(SHARE_PROMPTED_KEY) === '1',
  };
}

/** Write a merged profile back down to this device. */
function applyLocal(profile){
  if (!profile) return;
  if (profile.garage)  writeLocal(GARAGE_KEY, profile.garage);
  if (profile.social)  writeLocal(SOCIAL_HANDLES_KEY, profile.social);
  if (profile.car_pos) writeLocal(CAR_POS_KEY, profile.car_pos);
  if (profile.rec_pos) writeLocal(REC_POS_KEY, profile.rec_pos);
  // Flags are one-way: once true anywhere, true everywhere. Re-onboarding
  // someone because they picked up a second phone is a worse failure than
  // never showing it again.
  if (profile.onboarded)      localStorage.setItem(ONBOARDED_KEY, '1');
  if (profile.car_prompted)   localStorage.setItem(CAR_PROMPTED_KEY, '1');
  if (profile.share_prompted) localStorage.setItem(SHARE_PROMPTED_KEY, '1');
}

/** Fetch this account's profile row, or null (signed out, absent, or offline). */
export async function fetchProfile(){
  const headers = authHeaders();
  if (!headers) return null;
  try {
    const res = await fetch(`${ENDPOINT}?select=*`, { headers });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0] || null;
  } catch { return null; }
}

/**
 * Push the local profile up, creating the row if it isn't there.
 *
 * Upsert on user_id — the client never supplies it. The column defaults from
 * the JWT via RLS, so a caller cannot write into someone else's profile even
 * by asking nicely.
 */
export async function pushProfile(patch = {}){
  const headers = authHeaders();
  if (!headers) return false;
  const session = getSession();
  const userId  = session?.user?.id;
  if (!userId) return false;

  const body = { user_id: userId, ...collectLocal(), ...patch, updated_at: new Date().toISOString() };
  try {
    const res = await fetch(ENDPOINT, {
      method:  'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body:    JSON.stringify(body),
    });
    return res.ok;
  } catch { return false; }
}

/**
 * Reconcile this device with the account. Call on sign-in and on app start
 * while signed in.
 *
 * Returns the merged garage so the caller can re-render without a second read.
 */
export async function syncProfile(){
  const headers = authHeaders();
  if (!headers) return null;

  const remote = await fetchProfile();
  const local  = collectLocal();
  const garage = mergeGarages(local.garage, remote?.garage || []);

  const merged = {
    ...remote,
    ...local,
    garage,
    // Sticky flags: true on either side wins.
    onboarded:      Boolean(remote?.onboarded      || local.onboarded),
    car_prompted:   Boolean(remote?.car_prompted   || local.car_prompted),
    share_prompted: Boolean(remote?.share_prompted || local.share_prompted),
    // Positions: whatever the account already knows, unless this device has
    // some and the account has none.
    car_pos: remote?.car_pos || local.car_pos,
    rec_pos: remote?.rec_pos || local.rec_pos,
  };

  applyLocal(merged);
  await pushProfile(merged);
  return merged;
}

/**
 * Claim this device's anonymous drives.
 *
 * Goes through an RPC rather than a direct update: the old RLS policy allowed
 * any signed-in user to adopt ANY unowned row, which with a scoring leaderboard
 * is free history for whoever asks first. The function only takes rows already
 * stamped with the device_id passed in.
 */
export async function claimDrives(deviceId){
  const headers = authHeaders();
  if (!headers || !deviceId) return 0;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/claim_drives`, {
      method:  'POST',
      headers,
      body:    JSON.stringify({ p_device_id: deviceId }),
    });
    if (!res.ok) return 0;
    return Number(await res.json()) || 0;
  } catch { return 0; }
}
