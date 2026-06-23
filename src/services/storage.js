import {
  STORAGE_KEY,
  DEVICE_KEY,
  SYNCED_KEY,
  LIFETIME_SCORE_KEY,
  DRIVER_NAME_KEY,
  MAX_STORED_DRIVES,
  MAX_CORRIDOR_DRIVES,
  ACTIVE_DRIVE_KEY,
  OSM_SPEED_CACHE,
  OSM_CACHE_TTL,
  OSM_CACHE_MAX,
  SOCIAL_HANDLES_KEY,
  CORRIDORS_KEY,
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

// ── Social handles ────────────────────────────────────────────────────────────
export function loadSocialHandles(){
  try { return JSON.parse(localStorage.getItem(SOCIAL_HANDLES_KEY) || '{}'); } catch { return {}; }
}
export function saveSocialHandles(handles){
  try { localStorage.setItem(SOCIAL_HANDLES_KEY, JSON.stringify(handles)); } catch {}
}

// ── OSM speed-limit cache ─────────────────────────────────────────────────────
function osmCacheKey(lat, lon){
  return `${lat.toFixed(3)}_${lon.toFixed(3)}`;
}

function loadOsmCache(){
  try { return JSON.parse(localStorage.getItem(OSM_SPEED_CACHE) || '{}'); }
  catch { return {}; }
}

function saveOsmCache(cache){
  try { localStorage.setItem(OSM_SPEED_CACHE, JSON.stringify(cache)); } catch {}
}

export function getOsmLimit(lat, lon){
  const cache = loadOsmCache();
  const entry = cache[osmCacheKey(lat, lon)];
  if (!entry) return null;
  if (Date.now() - entry.ts > OSM_CACHE_TTL) return null;
  return entry.limitMps;
}

export function setOsmLimit(lat, lon, limitMps){
  const cache = loadOsmCache();
  const key   = osmCacheKey(lat, lon);
  cache[key]  = { limitMps, ts: Date.now() };
  // LRU eviction: drop oldest entries when over cap
  const keys  = Object.keys(cache);
  if (keys.length > OSM_CACHE_MAX){
    keys.sort((a, b) => cache[a].ts - cache[b].ts)
        .slice(0, keys.length - OSM_CACHE_MAX)
        .forEach(k => delete cache[k]);
  }
  saveOsmCache(cache);
}

// ── Corridors ─────────────────────────────────────────────────────────────────
export function loadCorridors(){
  try { return JSON.parse(localStorage.getItem(CORRIDORS_KEY) || '[]'); } catch { return []; }
}
export function saveCorridors(corridors){
  try { localStorage.setItem(CORRIDORS_KEY, JSON.stringify(corridors)); } catch {}
}
export function upsertCorridorDrive({ name, city, centerLat, centerLon, osmWayId, score, distanceMeters, drivenAt }){
  const all = loadCorridors();
  const id  = `${name}-${city}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const idx = all.findIndex(c => c.corridorId === id);
  const drive = { score, distanceMeters, drivenAt };
  if (idx === -1){
    all.push({ corridorId: id, name, city, centerLat, centerLon, osmWayId: osmWayId || null, drives: [drive] });
  } else {
    all[idx].drives.push(drive);
    if (all[idx].drives.length > MAX_CORRIDOR_DRIVES)
      all[idx].drives = all[idx].drives.slice(-MAX_CORRIDOR_DRIVES);
  }
  saveCorridors(all);
}
