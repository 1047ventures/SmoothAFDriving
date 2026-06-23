import {
  STORAGE_KEY,
  DEVICE_KEY,
  SYNCED_KEY,
  LIFETIME_SCORE_KEY,
  DRIVER_NAME_KEY,
  MAX_STORED_DRIVES,
  ACTIVE_DRIVE_KEY,
} from '../constants.js';

// ── Lifetime score ────────────────────────────────────────────────────────────
export function loadLifetimeScore(){
  try { const v = parseFloat(localStorage.getItem(LIFETIME_SCORE_KEY)); return isNaN(v) ? 100 : v; } catch { return 100; }
}
export function saveLifetimeScore(s){
  try { localStorage.setItem(LIFETIME_SCORE_KEY, String(Math.round(s))); } catch {}
}

// ── Driver name ───────────────────────────────────────────────────────────────
export function loadDriverName(){
  try { return localStorage.getItem(DRIVER_NAME_KEY) || ''; } catch { return ''; }
}
export function saveDriverName(n){
  try { localStorage.setItem(DRIVER_NAME_KEY, n.trim()); } catch {}
}

// ── Migration ─────────────────────────────────────────────────────────────────
// Run once if no lifetime score saved yet — derive it from stored drives.
// Most-recent drive carries the most weight (exponential decay factor 0.65).
export function migrateLifetimeScore(){
  const stored = localStorage.getItem(LIFETIME_SCORE_KEY);
  const drives = loadDrives().filter(d => d.score != null);
  if (!drives.length){ if (stored === null) saveLifetimeScore(100); return; }
  // Re-derive if never set, corrupted to 0, or implausibly low vs actual drives
  const storedVal = Number(stored);
  const recentAvg = drives.slice(0, 5).reduce((s, d) => s + d.score, 0) / Math.min(drives.length, 5);
  const implausible = stored === null || storedVal === 0 || storedVal < recentAvg - 30;
  if (!implausible) return;
  const recent = drives.slice(0, 10);
  saveLifetimeScore(Math.round(recent.reduce((s, d) => s + d.score, 0) / recent.length));
}

// ── Drives ────────────────────────────────────────────────────────────────────
export function loadDrives(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
export function saveDrives(all){
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(0, MAX_STORED_DRIVES))); } catch {}
}
export function saveDrive(drive){
  const all = loadDrives();
  all.unshift(drive);
  saveDrives(all);
}

export function toggleFavoriteDrive(idx, callbacks = {}){
  const all = loadDrives();
  if (!all[idx]) return;
  all[idx].starred = !all[idx].starred;
  saveDrives(all);
  callbacks.onUpdate?.();
}

export function deleteDrive(idx, callbacks = {}){
  const all = loadDrives();
  all.splice(idx, 1);
  saveDrives(all);
  callbacks.onUpdate?.();
}

// ── Device / sync ─────────────────────────────────────────────────────────────
export function getDeviceId(){
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id){
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function getSyncedIds(){
  try { return new Set(JSON.parse(localStorage.getItem(SYNCED_KEY) || '[]')); }
  catch { return new Set(); }
}

export function markSynced(driveId){
  const ids = getSyncedIds();
  ids.add(driveId);
  try { localStorage.setItem(SYNCED_KEY, JSON.stringify([...ids])); } catch {}
}
