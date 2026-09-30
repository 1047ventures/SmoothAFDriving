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

export function computeOverview(users, drives, nowMs) {
  const real = realDrives(drives);
  const devices = new Set(real.map(d => d.device_id));

  const firstSeen = new Map();
  const daysByDevice = new Map();
  const active7 = new Set();
  const active30 = new Set();

  for (const d of real) {
    const prev = firstSeen.get(d.device_id);
    if (prev == null || d.start_time < prev) firstSeen.set(d.device_id, d.start_time);

    let days = daysByDevice.get(d.device_id);
    if (!days) { days = new Set(); daysByDevice.set(d.device_id, days); }
    days.add(dayKey(d.start_time));

    if (d.start_time >= nowMs - 7 * MS_PER_DAY) active7.add(d.device_id);
    if (d.start_time >= nowMs - 30 * MS_PER_DAY) active30.add(d.device_id);
  }

  let returningUsers = 0;
  for (const days of daysByDevice.values()) if (days.size >= 2) returningUsers++;

  const byDay = new Map();
  for (const ts of firstSeen.values()) {
    const k = dayKey(ts);
    byDay.set(k, (byDay.get(k) || 0) + 1);
  }
  const installsByDay = [...byDay.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  const totalFlags = real.reduce((s, d) => s + (d.event_count || 0), 0);
  const fleetMiles = real.reduce((s, d) => s + (d.distance_meters || 0), 0) / METERS_PER_MILE;

  return {
    totalUsers: (users || []).length,
    totalDevices: devices.size,
    totalDrives: real.length,
    avgScore: mean(real.map(d => d.score).filter(s => s != null)),
    totalMiles: miles(real.reduce((s, d) => s + (d.distance_meters || 0), 0)),
    totalFlags,
    // Fleet-wide harsh moments per mile — a single number for "how rough is the
    // driving overall", comparable across users regardless of how far they drove.
    flagsPerMile: fleetMiles > 0.1 ? +(totalFlags / fleetMiles).toFixed(2) : null,
    activeUsers7d: active7.size,
    activeUsers30d: active30.size,
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

export function computeUserRows(users, drives) {
  const real = realDrives(drives);
  const usersByDevice = new Map((users || []).map(u => [u.device_id, u]));

  const drivesByDevice = new Map();
  for (const d of real) {
    let arr = drivesByDevice.get(d.device_id);
    if (!arr) { arr = []; drivesByDevice.set(d.device_id, arr); }
    arr.push(d);
  }

  const deviceIds = new Set([...usersByDevice.keys(), ...drivesByDevice.keys()]);
  const rows = [];

  for (const deviceId of deviceIds) {
    const u = usersByDevice.get(deviceId) || null;
    const ds = drivesByDevice.get(deviceId) || [];
    const starts = ds.map(d => d.start_time);
    const firstSeen = ds.length ? Math.min(...starts) : null;
    let lastSeen = ds.length ? Math.max(...starts) : null;
    if (lastSeen == null && u && u.updated_at) {
      const parsed = Date.parse(u.updated_at);
      lastSeen = Number.isNaN(parsed) ? null : parsed;
    }
    const meters = ds.reduce((s, d) => s + (d.distance_meters || 0), 0);
    const flags = ds.reduce((s, d) => s + (d.event_count || 0), 0);
    const mi = meters / METERS_PER_MILE;
    rows.push({
      deviceId,
      name: u ? (u.name || null) : null,
      email: u ? (u.email || null) : null,
      isAnonymous: !u,
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
