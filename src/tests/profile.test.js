import { describe, it, expect } from 'vitest';
import { mergeGarages } from '../services/profile.js';

// mergeGarages is the only place a hand-entered vehicle can be silently
// destroyed, so it gets tested directly rather than through the sync.
describe('mergeGarages', () => {
  it('keeps vehicles that exist on only one side', () => {
    const merged = mergeGarages(
      [{ id: 'local',  make: 'Toyota' }],
      [{ id: 'remote', make: 'Honda'  }],
    );
    expect(merged.map(v => v.id).sort()).toEqual(['local', 'remote']);
  });

  it('prefers the newer record when both sides have the same vehicle', () => {
    const merged = mergeGarages(
      [{ id: 'a', make: 'Toyota', updated_at: '2026-08-15T10:00:00Z' }],
      [{ id: 'a', make: 'Honda',  updated_at: '2026-08-14T10:00:00Z' }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].make).toBe('Toyota');
  });

  it('treats a missing timestamp as oldest rather than coin-flipping', () => {
    const merged = mergeGarages(
      [{ id: 'a', make: 'NoStamp' }],
      [{ id: 'a', make: 'Stamped', updated_at: '2026-08-14T10:00:00Z' }],
    );
    expect(merged[0].make).toBe('Stamped');
  });

  it('never returns two active vehicles', () => {
    const merged = mergeGarages(
      [{ id: 'a', active: true }],
      [{ id: 'b', active: true }],
    );
    expect(merged.filter(v => v.active)).toHaveLength(1);
  });

  it('promotes one vehicle to active when neither side marked any', () => {
    const merged = mergeGarages([{ id: 'a' }], [{ id: 'b' }]);
    expect(merged.filter(v => v.active)).toHaveLength(1);
  });

  it('survives empty, missing, and malformed input', () => {
    expect(mergeGarages()).toEqual([]);
    expect(mergeGarages([], [])).toEqual([]);
    // Entries with no id can't be merged coherently, so they're dropped rather
    // than duplicated on every sync.
    expect(mergeGarages([null, { make: 'no id' }], [])).toEqual([]);
  });

  it('does not lose a vehicle when the same garage syncs twice', () => {
    const once  = mergeGarages([{ id: 'a', make: 'Toyota' }], []);
    const twice = mergeGarages(once, once);
    expect(twice).toHaveLength(1);
    expect(twice[0].make).toBe('Toyota');
  });
});
