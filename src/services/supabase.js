import { loadDrives, getDeviceId, getSyncedIds, markSynced } from './storage.js';

const SB_URL  = 'https://dbreetxubxdxogmektxc.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRicmVldHh1YnhkeG9nbWVrdHhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMjY5ODgsImV4cCI6MjA5MjkwMjk4OH0.hMeEhYpNNgZ67Nh9GnjwJvtSBbdQVhbdjiBBNNG5qe4';

export async function pushDriveToSupabase(drive){
  if (!drive || !drive.startTime) return;
  const driveId = String(drive.startTime); // stable local ID
  if (getSyncedIds().has(driveId)) return;  // already uploaded
  try {
    const payload = {
      device_id:       getDeviceId(),
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
    };
    const res = await fetch(`${SB_URL}/rest/v1/drives`, {
      method: 'POST',
      headers: {
        'apikey':        SB_ANON,
        'Authorization': `Bearer ${SB_ANON}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) markSynced(driveId);
  } catch { /* offline – will retry on next startup */ }
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
