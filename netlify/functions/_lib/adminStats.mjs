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

  return {
    totalUsers: (users || []).length,
    totalDevices: devices.size,
    totalDrives: real.length,
    avgScore: mean(real.map(d => d.score).filter(s => s != null)),
    totalMiles: miles(real.reduce((s, d) => s + (d.distance_meters || 0), 0)),
    activeUsers7d: active7.size,
    activeUsers30d: active30.size,
    returningUsers,
    installsByDay,
  };
}
