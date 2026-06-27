import { describe, it, expect } from 'vitest';
import { computeOverview } from '../../netlify/functions/_lib/adminStats.mjs';

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
