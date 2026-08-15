import { loadDrives, getDeviceId, getSyncedIds, markSynced } from './storage.js';
import {
  DRIVER_NAME_KEY, USER_EMAIL_KEY, ONBOARDED_KEY, PROFILE_SYNCED_KEY,
  SB_URL, SB_ANON,
} from '../constants.js';
import { authHeaders, currentUser } from './auth.js';

export async function pushDriveToSupabase(drive){
  if (!drive || !drive.startTime) return;
  const driveId = String(drive.startTime); // stable local ID
  if (getSyncedIds().has(driveId)) return;  // already uploaded
  try {
    const uid = currentUser()?.id;
    const payload = {
      device_id:       getDeviceId(),
      // Stamped at insert time — this is what makes a drive follow the driver to
      // a new phone instead of being stranded on this one.
      //
      // OMITTED entirely when signed out rather than sent as null, so an app
      // build that reaches a database where the accounts migration hasn't run
      // yet still uploads exactly as it did before. Sending the key would 400 on
      // the missing column, and pushDriveToSupabase swallows errors — drives
      // would silently stop syncing.
      ...(uid ? { user_id: uid } : {}),
      start_time:      drive.startTime,
      duration_ms:     drive.durationMs,
      distance_meters: drive.distanceMeters,
      top_speed_mps:   drive.topSpeedMps,
      score:           drive.score,
      event_count:     drive.eventCount,
      simulated:       !!drive.simulated,
      settings:        drive.settingsSnapshot || null,
      samples:         drive.samples,
      events:          drive.events,
      dest_label:       drive.destination?.label ?? null,
      dest_lat:         drive.destination?.lat ?? null,
      dest_lng:         drive.destination?.lng ?? null,
      route_distance_m: drive.routeDistanceM ?? null,
      target_eta_sec:   drive.targetEtaSec ?? null,
      effectiveness:    drive.effectiveness ?? null,
    };
    let res = await postDrive(payload);

    // The accounts migration may not have reached this database yet, in which
    // case PostgREST rejects the unknown user_id column (PGRST204 / 400). The
    // drive itself is still perfectly valid without it, and this function
    // swallows failures — so without this retry a signed-in driver would just
    // silently stop syncing. Drop the column and send it as an anonymous row;
    // signing in again later claims it via claimDeviceDrives().
    if (!res.ok && uid && await mentionsUserIdColumn(res)){
      const { user_id, ...withoutUser } = payload;
      res = await postDrive(withoutUser);
    }

    if (res.ok) markSynced(driveId);
  } catch { /* offline – will retry on next startup */ }
}

function postDrive(payload){
  return fetch(`${SB_URL}/rest/v1/drives`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify(payload),
  });
}

/** True when a failed response blames the user_id column specifically. */
async function mentionsUserIdColumn(res){
  try {
    const body = await res.clone().text();
    return /user_id/.test(body);
  } catch { return false; }
}

// Sync any drives that weren't uploaded yet (e.g. was offline during drive)
export function syncPendingDrives(){
  const drives = loadDrives();
  drives.forEach(d => pushDriveToSupabase(d));
}

export async function syncToLeaderboard(name, score){
  try {
    await fetch(`${SB_URL}/rest/v1/drivers`, {
      method:'POST',
      headers:{
        'apikey':SB_ANON,'Authorization':`Bearer ${SB_ANON}`,
        'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'
      },
      body:JSON.stringify({ device_id:getDeviceId(), username:name.trim(), lifetime_score:Math.round(score), updated_at:new Date().toISOString() })
    });
  } catch {}
}

export async function fetchLeaderboard(){
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/drivers?select=username,lifetime_score&order=lifetime_score.desc&limit=25`,
      { headers:{ 'apikey':SB_ANON, 'Authorization':`Bearer ${SB_ANON}` } }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export async function registerUser({ name, email, device_id }) {
  try {
    const res = await fetch('/.netlify/functions/register-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, device_id }),
    });
    if (res.ok) localStorage.setItem(PROFILE_SYNCED_KEY, '1');
  } catch { /* offline — caller retries via syncUserProfile on next startup */ }
}

export async function syncUserProfile() {
  if (!localStorage.getItem(ONBOARDED_KEY)) return;
  if (localStorage.getItem(PROFILE_SYNCED_KEY)) return;
  const name  = localStorage.getItem(DRIVER_NAME_KEY) || '';
  const email = localStorage.getItem(USER_EMAIL_KEY)  || '';
  await registerUser({ name, email, device_id: getDeviceId() });
}

/**
 * Fetch a device's drives from the cloud, METADATA ONLY (no GPS samples).
 *
 * Samples dominate the payload — a full history runs past the ~5 MB
 * localStorage budget, while the same drives without samples are ~74 KB. The
 * list, scores, and lifetime stats need none of it; only the review map does,
 * and that can be fetched per-drive on demand.
 *
 * Returns cloud rows (newest first), or null on any failure — never throws.
 */
const DRIVE_COLS = 'start_time,duration_ms,distance_meters,top_speed_mps,score,event_count,'
                 + 'simulated,dest_label,dest_lat,dest_lng,route_distance_m,target_eta_sec,effectiveness';

export async function fetchCloudDrives(deviceId){
  if (!deviceId) return null;
  return selectDrives(`device_id=eq.${encodeURIComponent(deviceId)}`);
}

/**
 * Every drive belonging to the signed-in account, across all their devices.
 * This is what restore becomes once identity exists — no UUID to paste.
 */
export async function fetchDrivesForUser(){
  const uid = currentUser()?.id;
  if (!uid) return null;
  return selectDrives(`user_id=eq.${encodeURIComponent(uid)}`);
}

async function selectDrives(filter){
  try {
    const url = `${SB_URL}/rest/v1/drives?select=${DRIVE_COLS}&${filter}&order=start_time.desc`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

/**
 * Adopt this device's previously anonymous drives into the account that just
 * signed in.
 *
 * Everything recorded before accounts existed is stamped with a device_id and a
 * null user_id. Without this, signing in would look like starting over — the
 * history would still be in the cloud but invisible to the new identity.
 *
 * Idempotent: the `user_id=is.null` filter means a second run matches nothing.
 * Returns the number of rows claimed, or null if the call failed.
 */
export async function claimDeviceDrives(){
  const uid = currentUser()?.id;
  if (!uid) return null;
  try {
    const url = `${SB_URL}/rest/v1/drives`
              + `?device_id=eq.${encodeURIComponent(getDeviceId())}&user_id=is.null`;
    const res = await fetch(url, {
      method:  'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body:    JSON.stringify({ user_id: uid }),
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) ? rows.length : 0;
  } catch {
    return null;
  }
}

/** Map a cloud row onto the local drive shape the UI expects. */
export function cloudRowToDrive(r){
  return {
    startTime:      r.start_time,
    durationMs:     r.duration_ms,
    distanceMeters: r.distance_meters,
    topSpeedMps:    r.top_speed_mps,
    score:          r.score,
    eventCount:     r.event_count || 0,
    simulated:      !!r.simulated,
    effectiveness:  r.effectiveness ?? null,
    targetEtaSec:   r.target_eta_sec ?? null,
    routeDistanceM: r.route_distance_m ?? null,
    destination:    r.dest_label ? { label: r.dest_label, lat: r.dest_lat, lng: r.dest_lng } : null,
    // Restored drives carry no GPS track or events — the list and stats don't
    // need them, and the review map re-fetches on demand.
    samples: [],
    events:  [],
    restored: true,
  };
}
