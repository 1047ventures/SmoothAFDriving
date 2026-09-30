// Pure analytics aggregators. No I/O, no Date.now() — caller passes nowMs so
// results are deterministic and unit-testable.

const MS_PER_DAY = 864e5;
const METERS_PER_MILE = 1609.34;

function realDrives(drives) {
  return (drives || []).filter(d => !d.simulated);
}

function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10); // UTC YYYY-MM-DD
}

function mean(nums) {
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
}

function miles(meters) {
  return +(meters / METERS_PER_MILE).toFixed(1);
}

// ── Identity: fold a person's many device ids into one ────────────────────────
// A single person shows up under several device_ids — the web PWA, the native
// app, and every reinstall each mint a fresh one, and different deploy origins
// don't share storage. We group them by, in priority order:
//   1. the email attached to the device in the users table (operator's label),
//   2. the account user_id stamped on the drive (set once they sign in),
//   3. the device_id itself, for a still-anonymous, unlabelled device.
// Email leads so that labelling two device_ids with the same email merges them
// even when only one of them has an account.

function emailByDeviceMap(users) {
  const m = new Map();
  for (const u of users || []) if (u.email) m.set(u.device_id, String(u.email).toLowerCase());
  return m;
}

function identityKey(deviceId, userId, emailByDevice) {
  const em = emailByDevice.get(deviceId);
  if (em) return 'em:' + em;
  if (userId) return 'uid:' + userId;
  return 'dev:' + deviceId;
}

// Returns Map<identityKey, { key, devices:Set, drives:[], name, email, updatedAts:[] }>.
function groupByIdentity(users, drives) {
  const real = realDrives(drives);
  const emailByDevice = emailByDeviceMap(users);
  const usersByDevice = new Map((users || []).map(u => [u.device_id, u]));
  const groups = new Map();
  const ensure = (key) => {
    let g = groups.get(key);
    if (!g) { g = { key, devices: new Set(), drives: [], name: null, email: null, updatedAts: [] }; groups.set(key, g); }
    return g;
  };

  // Seed from the users table so a known signup with no drives still appears.
  for (const u of users || []) {
    const g = ensure(identityKey(u.device_id, null, emailByDevice));
    g.devices.add(u.device_id);
    if (u.name && !g.name) g.name = u.name;
    if (u.email && !g.email) g.email = String(u.email).toLowerCase();
    if (u.updated_at) { const t = Date.parse(u.updated_at); if (!Number.isNaN(t)) g.updatedAts.push(t); }
  }
  for (const d of real) {
    const g = ensure(identityKey(d.device_id, d.user_id, emailByDevice));
    g.devices.add(d.device_id);
    g.drives.push(d);
    const u = usersByDevice.get(d.device_id);
    if (u) { if (u.name && !g.name) g.name = u.name; if (u.email && !g.email) g.email = String(u.email).toLowerCase(); }
  }
  return groups;
}

export function computeOverview(users, drives, nowMs) {
  const real = realDrives(drives);
  const devices = new Set(real.map(d => d.device_id));
  const groups = groupByIdentity(users, drives);

  // Installs are counted per DEVICE (an install is a device), not per person.
  const firstSeenDev = new Map();
  for (const d of real) {
    const prev = firstSeenDev.get(d.device_id);
    if (prev == null || d.start_time < prev) firstSeenDev.set(d.device_id, d.start_time);
  }
  const byDay = new Map();
  for (const ts of firstSeenDev.values()) {
    const k = dayKey(ts);
    byDay.set(k, (byDay.get(k) || 0) + 1);
  }
  const installsByDay = [...byDay.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  // Person-level metrics roll up per identity, so one human with two phones
  // counts once — the whole point of the merge.
  let active7 = 0, active30 = 0, returningUsers = 0, knownUsers = 0;
  for (const g of groups.values()) {
    if (g.name || g.email) knownUsers++;
    const starts = g.drives.map(d => d.start_time);
    if (starts.some(t => t >= nowMs - 7 * MS_PER_DAY)) active7++;
    if (starts.some(t => t >= nowMs - 30 * MS_PER_DAY)) active30++;
    const days = new Set(g.drives.map(d => dayKey(d.start_time)));
    if (days.size >= 2) returningUsers++;
  }

  const totalFlags = real.reduce((s, d) => s + (d.event_count || 0), 0);
  const fleetMiles = real.reduce((s, d) => s + (d.distance_meters || 0), 0) / METERS_PER_MILE;

  return {
    // "Users" = known people (named or emailed); anonymous device-only identities
    // are excluded from the headline count but still listed in the table.
    totalUsers: knownUsers,
    totalIdentities: groups.size,
    totalDevices: devices.size,
    totalDrives: real.length,
    avgScore: mean(real.map(d => d.score).filter(s => s != null)),
    totalMiles: miles(real.reduce((s, d) => s + (d.distance_meters || 0), 0)),
    totalFlags,
    // Fleet-wide harsh moments per mile — a single "how rough is the driving"
    // number, comparable regardless of how far anyone drove.
    flagsPerMile: fleetMiles > 0.1 ? +(totalFlags / fleetMiles).toFixed(2) : null,
    activeUsers7d: active7,
    activeUsers30d: active30,
    returningUsers,
    installsByDay,
  };
}

/**
 * Break a drive's harsh-event list into counts by type and severity tier.
 *
 * These are the "flags": the brake/accel/turn/shift moments the engine caught.
 * Pure and defensive — every drive already stores its events array, so this
 * works on historical drives too, no new column required.
 */
export function summarizeFlags(events) {
  const out = { total: 0, byType: { brake: 0, accel: 0, turn: 0, shift: 0 }, byTier: { 1: 0, 2: 0, 3: 0, 4: 0 } };
  for (const e of events || []) {
    out.total++;
    const type = e && e.type;
    if (type) out.byType[type] = (out.byType[type] || 0) + 1;
    const tier = (e && e.tier) || 2;
    out.byTier[tier] = (out.byTier[tier] || 0) + 1;
  }
  return out;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * The end-of-day digest: all-time totals plus today's deltas, with "today"
 * bounded in the owner's local day via a fixed UTC offset (in hours).
 *
 * Deliberately offset-based arithmetic rather than Intl named time zones: the
 * Cloudflare Workers runtime is unreliable with `Intl.DateTimeFormat`
 * timeZone/dateStyle, and a digest boundary that's an hour off across a DST
 * switch twice a year doesn't matter for daily counts. Aggregate only — counts
 * and sums, never a user row.
 */
export function computeDailyDigest(users, drives, nowMs, tzOffsetHours = -6) {
  const real = realDrives(drives);
  const ov = computeOverview(users, drives, nowMs);
  const rows = computeUserRows(users, drives);

  const offsetMs = tzOffsetHours * 3600 * 1000;
  const localNow = nowMs + offsetMs;                        // shift to local wall clock
  const localMidnight = Math.floor(localNow / 864e5) * 864e5;
  const dayStart = localMidnight - offsetMs;               // back to the real (UTC) instant
  const ld = new Date(localMidnight);                      // its UTC Y/M/D are the local date

  const todays = real.filter(d => d.start_time >= dayStart);
  const milesToday = miles(todays.reduce((s, d) => s + (d.distance_meters || 0), 0));
  const scoresToday = todays.map(d => d.score).filter(s => s != null);

  return {
    date: `${DAY_NAMES[ld.getUTCDay()]}, ${MONTH_NAMES[ld.getUTCMonth()]} ${ld.getUTCDate()}, ${ld.getUTCFullYear()}`,
    tzOffsetHours,
    // today
    newDriversToday: rows.filter(r => r.firstSeen != null && r.firstSeen >= dayStart).length,
    activeToday:     rows.filter(r => r.lastSeen != null && r.lastSeen >= dayStart).length,
    drivesToday:     todays.length,
    milesToday,
    avgScoreToday:   scoresToday.length ? Math.round(scoresToday.reduce((a, b) => a + b, 0) / scoresToday.length) : null,
    flagsToday:      todays.reduce((s, d) => s + (d.event_count || 0), 0),
    // all-time
    totalUsers:      ov.totalUsers,
    totalDevices:    ov.totalDevices,
    totalDrives:     ov.totalDrives,
    totalMiles:      ov.totalMiles,
    avgScore:        ov.avgScore,
    activeUsers7d:   ov.activeUsers7d,
  };
}

export function computeUserRows(users, drives) {
  const groups = groupByIdentity(users, drives);
  const rows = [];

  for (const g of groups.values()) {
    const ds = g.drives;
    const starts = ds.map(d => d.start_time);
    const firstSeen = ds.length ? Math.min(...starts) : null;
    let lastSeen = ds.length ? Math.max(...starts) : null;
    if (lastSeen == null && g.updatedAts.length) lastSeen = Math.max(...g.updatedAts);
    const meters = ds.reduce((s, d) => s + (d.distance_meters || 0), 0);
    const flags = ds.reduce((s, d) => s + (d.event_count || 0), 0);
    const mi = meters / METERS_PER_MILE;
    const devices = [...g.devices];
    rows.push({
      // The drill-down fetches by this identity's full device-id list, so a
      // merged person shows every device's drives together.
      identityKey: g.key,
      deviceIds: devices,
      deviceId: devices[0] || null,   // first device — kept for back-compatible callers
      deviceCount: devices.length,
      name: g.name || null,
      email: g.email || null,
      isAnonymous: !g.name && !g.email,
      driveCount: ds.length,
      firstSeen,
      lastSeen,
      avgScore: mean(ds.map(d => d.score).filter(s => s != null)),
      totalMiles: miles(meters),
      // Behaviour: total harsh moments and how often they happen per mile — the
      // per-mile figure is the fair cross-user comparison (a long calm highway
      // drive shouldn't look worse than a short jumpy one just for being longer).
      flags,
      flagsPerMile: mi > 0.1 ? +(flags / mi).toFixed(2) : null,
    });
  }

  rows.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  return rows;
}
