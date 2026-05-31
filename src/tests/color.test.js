import { describe, it, expect } from 'vitest';
import { harshnessToColor, forceSegmentColor, scoreColor, dimColor } from '../utils/color.js';

describe('harshnessToColor', () => {
  it('returns green for low harshness', () => expect(harshnessToColor(0.5)).toBe('#6FB669'));
  it('returns yellow for moderate', () => expect(harshnessToColor(2.0)).toBe('#B6B85A'));
  it('returns red for high', () => expect(harshnessToColor(5.0)).toBe('#E03B2F'));
});

describe('forceSegmentColor', () => {
  it('returns green when coasting (near-zero forces)', () => {
    expect(forceSegmentColor(0, 0)).toBe('#6FB669');
  });
  it('returns brake color for negative la', () => {
    const color = forceSegmentColor(-3.5, 0);
    expect(color).toBe('#E03B2F');
  });
  it('returns accel color for positive la', () => {
    const color = forceSegmentColor(3.0, 0);
    expect(color).toBe('#E8A03A');
  });
});

describe('scoreColor', () => {
  it('green for 90', () => expect(scoreColor(90)).toBe('#6FB669'));
  it('gold for 70', () => expect(scoreColor(70)).toBe('#C4A962'));
  it('orange for 50', () => expect(scoreColor(50)).toBe('#E8A03A'));
  it('red for 30', () => expect(scoreColor(30)).toBe('#E03B2F'));
});

describe('dimColor', () => {
  it('green for 85', () => expect(dimColor(85)).toBe('var(--good)'));
  it('yellow for 65', () => expect(dimColor(65)).toBe('var(--warn)'));
  it('red for 40', () => expect(dimColor(40)).toBe('var(--danger)'));
});
