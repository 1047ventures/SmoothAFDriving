import { describe, it, expect } from 'vitest';
import { loadLog, recordOutcome, labelled, tunedWaitMs, tunedConfig, isTrusted, summarize, LEARN } from '../services/autoEndLearn.js';
import { AUTO_END } from '../services/autoEnd.js';

const mem = () => { const m = {}; return { getItem: k => m[k] ?? null, setItem: (k, v) => { m[k] = String(v); }, _m: m }; };
const log = (...answers) => answers.map((a, i) => ({ t: i, reason: 'link-lost', answer: a }));   // oldest → newest

describe('recording outcomes', () => {
  it('persists answers and reads them back', () => {
    const st = mem();
    recordOutcome({ reason: 'link-lost', answer: 'end', parkedMs: 31000 }, st);
    recordOutcome({ reason: 'engine-off', answer: 'keep' }, st);
    expect(loadLog(st).map(e => e.answer)).toEqual(['end', 'keep']);
  });

  it('keeps the log bounded', () => {
    const st = mem();
    for (let i = 0; i < LEARN.MAX_LOG + 25; i++) recordOutcome({ reason: 'link-lost', answer: 'end' }, st);
    expect(loadLog(st)).toHaveLength(LEARN.MAX_LOG);
  });

  it('survives corrupt storage', () => {
    const st = { getItem: () => '{not json', setItem() {} };
    expect(loadLog(st)).toEqual([]);
  });

  it('only end / keep / moved are labels — timeout and auto teach nothing', () => {
    const l = log('end', 'timeout', 'auto', 'keep', 'moved');
    expect(labelled(l, 'link-lost').map(e => e.answer)).toEqual(['moved', 'keep', 'end']);   // newest first
  });
});

describe('tuning the wait from the driver’s answers', () => {
  const base = AUTO_END.LINK_LOST_PARKED_MS;

  it('keeps the default with no history', () => {
    expect(tunedWaitMs([], 'link-lost', base)).toBe(base);
  });

  it('waits longer after a wrong call, and longer still after more', () => {
    expect(tunedWaitMs(log('keep'), 'link-lost', base)).toBe(base * 1.5);
    expect(tunedWaitMs(log('keep', 'moved'), 'link-lost', base)).toBe(base * 2);
  });

  it('never waits more than 3x the default', () => {
    expect(tunedWaitMs(log('keep', 'keep', 'keep', 'keep', 'keep'), 'link-lost', base)).toBe(base * LEARN.MAX_LENGTHEN);
  });

  it('shortens the wait after a clean run of confirmations, down to a floor', () => {
    expect(tunedWaitMs(log('end', 'end', 'end'), 'link-lost', base)).toBe(Math.round(base * LEARN.SHORTEN_FACTOR));
    expect(tunedWaitMs(log('end', 'end', 'end'), 'link-lost', 20_000)).toBe(LEARN.FLOOR_MS['link-lost']);   // 12 s would go under the 15 s floor
  });

  it('does not shorten on fewer than 3 confirmations', () => {
    expect(tunedWaitMs(log('end', 'end'), 'link-lost', base)).toBe(base);
  });

  it('a wrong call outweighs earlier confirmations', () => {
    expect(tunedWaitMs(log('end', 'end', 'end', 'keep'), 'link-lost', base)).toBe(base * 1.5);
  });

  it('only the last 5 labelled answers count — an old miss is forgiven', () => {
    expect(tunedWaitMs(log('keep', 'end', 'end', 'end', 'end', 'end'), 'link-lost', base))
      .toBe(Math.round(base * LEARN.SHORTEN_FACTOR));
  });

  it('tunes each signal independently', () => {
    const l = [{ reason: 'engine-off', answer: 'keep' }, ...log('end', 'end', 'end')];
    const c = tunedConfig(l);
    expect(c.RPM_ZERO_PARKED_MS).toBe(AUTO_END.RPM_ZERO_PARKED_MS * 1.5);
    expect(c.LINK_LOST_PARKED_MS).toBeLessThan(AUTO_END.LINK_LOST_PARKED_MS);
  });
});

describe('graduating to "stop asking"', () => {
  it('needs 8 consecutive confirmations', () => {
    expect(isTrusted(log(...Array(7).fill('end')), 'link-lost')).toBe(false);
    expect(isTrusted(log(...Array(8).fill('end')), 'link-lost')).toBe(true);
  });

  it('one wrong call sends it straight back to asking', () => {
    expect(isTrusted(log(...Array(10).fill('end'), 'keep'), 'link-lost')).toBe(false);
    expect(isTrusted(log(...Array(10).fill('end'), 'moved'), 'link-lost')).toBe(false);
  });

  it('un-labelled outcomes (timeout / auto) neither earn nor lose trust', () => {
    expect(isTrusted(log(...Array(8).fill('end'), 'timeout', 'auto'), 'link-lost')).toBe(true);
    expect(isTrusted(log(...Array(7).fill('end'), 'timeout', 'timeout'), 'link-lost')).toBe(false);
  });

  it('trust is per signal', () => {
    expect(isTrusted(log(...Array(8).fill('end')), 'engine-off')).toBe(false);
  });

  it('summarize reports the tally', () => {
    expect(summarize(log('end', 'end', 'keep'), 'link-lost')).toEqual({ asked: 3, right: 2, wrong: 1, trusted: false });
  });
});
