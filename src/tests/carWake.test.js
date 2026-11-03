import { describe, it, expect } from 'vitest';
import { seatThreshold, SEAT_RSSI_DEFAULT } from '../services/carWake.js';

const samples = (rssi, n = 20) => Array(n).fill(rssi);

describe('seatThreshold', () => {
  it('uses the default until enough drive readings exist', () => {
    expect(seatThreshold([])).toBe(SEAT_RSSI_DEFAULT);
    expect(seatThreshold(null)).toBe(SEAT_RSSI_DEFAULT);
    expect(seatThreshold(samples(-50, 9))).toBe(SEAT_RSSI_DEFAULT);
  });

  it('sits a margin below the weak end of what the phone sees driving', () => {
    expect(seatThreshold(samples(-60))).toBe(-66);
    // One bad reading in twenty doesn't move it.
    expect(seatThreshold([...samples(-60, 19), -90])).toBe(-66);
  });

  it('never gets so loose that 20 feet away counts as in the seat', () => {
    expect(seatThreshold(samples(-85))).toBe(-72);
  });

  it('never gets so strict that a phone in a pocket fails', () => {
    expect(seatThreshold(samples(-35))).toBe(-55);
  });
});
