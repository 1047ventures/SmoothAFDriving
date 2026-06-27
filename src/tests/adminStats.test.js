import { describe, it, expect } from 'vitest';
import { computeOverview, computeUserRows } from '../../netlify/functions/_lib/adminStats.mjs';

const DAY = 864e5;
const NOW = 1_700_000_000_000;            // fixed "now" for deterministic windows
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

const USERS = [
  { device_id: 'dev-A', name: 'Alice', email: 'a@x.com', updated_at: '2023-11-13T00:00:00Z' },
  { device_id: 'dev-B', name: 'Bob',   email: 'b@x.com', updated_at: '2023-11-04T00:00:00Z' },
  { device_id: 'dev-D', name: 'Dana',  email: 'd@x.com', updated_at: '2023-11-10T00:00:00Z' },
];
const DRIVES = [
  { device_id: 'dev-A', start_time: NOW - 2 * DAY, score: 90, distance_meters: 1609.34, simulated: false },
  { device_id: 'dev-A', start_time: NOW - 1 * DAY, score: 80, distance_meters: 3218.68, simulated: false },
  { device_id: 'dev-B', start_time: NOW - 10 * DAY, score: 70, distance_meters: 1609.34, simulated: false },
  { device_id: 'dev-C', start_time: NOW - 100 * DAY, score: 50, distance_meters: 0, simulated: false },
  { device_id: 'dev-A', start_time: NOW, score: 0, distance_meters: 9999, simulated: true }, // excluded
];

describe('computeOverview', () => {
  const ov = computeOverview(USERS, DRIVES, NOW);

  it('counts users, devices, drives (simulated excluded)', () => {
    expect(ov.totalUsers).toBe(3);
    expect(ov.totalDevices).toBe(3);
    expect(ov.totalDrives).toBe(4);
  });

  it('averages score and sums miles over real drives only', () => {
    expect(ov.avgScore).toBe(73);
    expect(ov.totalMiles).toBe(4);
  });

  it('computes active windows relative to nowMs', () => {
    expect(ov.activeUsers7d).toBe(1);
    expect(ov.activeUsers30d).toBe(2);
  });

  it('counts returning users (drives on >= 2 distinct UTC days)', () => {
    expect(ov.returningUsers).toBe(1);
  });

  it('buckets installs by each device first-seen day, sorted ascending', () => {
    expect(ov.installsByDay).toEqual([
      { day: day(NOW - 100 * DAY), count: 1 },
      { day: day(NOW - 10 * DAY),  count: 1 },
      { day: day(NOW - 2 * DAY),   count: 1 },
    ]);
  });
});

describe('computeUserRows', () => {
  const rows = computeUserRows(USERS, DRIVES);

  it('returns one row per device (union of users and real drives)', () => {
    expect(rows.length).toBe(4); // A, B, C, D
  });

  it('sorts by lastSeen descending', () => {
    expect(rows.map(r => r.deviceId)).toEqual(['dev-A', 'dev-D', 'dev-B', 'dev-C']);
  });

  it('aggregates a known user correctly', () => {
    const a = rows.find(r => r.deviceId === 'dev-A');
    expect(a.name).toBe('Alice');
    expect(a.isAnonymous).toBe(false);
    expect(a.driveCount).toBe(2);
    expect(a.avgScore).toBe(85);
    expect(a.totalMiles).toBe(3);
    expect(a.firstSeen).toBe(NOW - 2 * DAY);
    expect(a.lastSeen).toBe(NOW - 1 * DAY);
  });

  it('flags devices with drives but no user row as anonymous', () => {
    const c = rows.find(r => r.deviceId === 'dev-C');
    expect(c.isAnonymous).toBe(true);
    expect(c.name).toBeNull();
    expect(c.email).toBeNull();
    expect(c.driveCount).toBe(1);
    expect(c.avgScore).toBe(50);
  });

  it('includes users who never drove (zero drives, null scores)', () => {
    const d = rows.find(r => r.deviceId === 'dev-D');
    expect(d.driveCount).toBe(0);
    expect(d.avgScore).toBeNull();
    expect(d.firstSeen).toBeNull();
    expect(d.totalMiles).toBe(0);
    expect(d.lastSeen).toBe(Date.parse('2023-11-10T00:00:00Z'));
  });
});
