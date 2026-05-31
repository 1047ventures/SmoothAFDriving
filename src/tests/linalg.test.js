import { describe, it, expect } from 'vitest';
import { dot3, norm3, normalise3, gaussElim3, solveLS3 } from '../utils/linalg.js';

describe('dot3', () => {
  it('computes dot product', () => expect(dot3([1, 2, 3], [4, 5, 6])).toBe(32));
  it('returns 0 for perpendicular unit vectors', () => expect(dot3([1, 0, 0], [0, 1, 0])).toBe(0));
});

describe('norm3', () => {
  it('returns 1 for unit vector', () => expect(norm3([1, 0, 0])).toBeCloseTo(1));
  it('returns correct magnitude', () => expect(norm3([3, 4, 0])).toBeCloseTo(5));
});

describe('normalise3', () => {
  it('produces unit vector', () => {
    const v = normalise3([3, 4, 0]);
    expect(norm3(v)).toBeCloseTo(1);
  });
  it('returns null for zero vector', () => expect(normalise3([0, 0, 0])).toBeNull());
});

describe('gaussElim3', () => {
  it('solves identity system', () => {
    const M = [[1,0,0],[0,1,0],[0,0,1]];
    const b = [1, 2, 3];
    expect(gaussElim3(M, b)).toEqual([1, 2, 3]);
  });

  it('returns null for singular matrix', () => {
    const M = [[1,2,3],[4,5,6],[7,8,9]]; // rank-deficient
    expect(gaussElim3(M, [1,2,3])).toBeNull();
  });
});

describe('solveLS3', () => {
  it('solves an over-determined system with a clean solution', () => {
    // 4 equations, solution v=[2,0,0]: ATA = diag([5,9,1]), ATb=[10,0,0]
    const rows = [[2,0,0],[0,3,0],[0,0,1],[1,0,0]];
    const b    = [4, 0, 0, 2];
    const v    = solveLS3(rows, b);
    expect(v).not.toBeNull();
    expect(v[0]).toBeCloseTo(2);
    expect(v[1]).toBeCloseTo(0);
  });
});
