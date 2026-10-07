import { describe, it, expect } from 'vitest';
import { createLiveInsights, createInsightFeed, longestCleanStreakMi, ribbonSeries, isHarsh, LIVE } from '../services/liveInsights.js';

const M = 111111, MI = 1609.34;
// Build 1 Hz samples from a list of speeds (m/s). Position advances north by the speed; longAccel is the speed change.
function drive(speeds, { t0 = 0 } = {}){
  let lat = 39.7, prev = speeds[0];
  return speeds.map((v, i) => { lat += v / M; const s = { t: t0 + i * 1000, lat, lon: -104.9, speed: v, longAccel: v - prev }; prev = v; return s; });
}
const cruise = (n, v = 14) => Array(n).fill(v);
const ramp = (from, to, secs) => Array.from({ length: secs }, (_, i) => from + (to - from) * ((i + 1) / secs));
const run = (speeds, events = [], opts) => { const li = createLiveInsights(opts); const s = drive(speeds); return { li, s, r: li.update(s, events) }; };
const kinds = r => r.insights.map(i => i.kind);

describe('harsh events', () => {
  it('only tier-2+ non-shift events are harsh', () => {
    expect(isHarsh({ type: 'brake', tier: 2 })).toBe(true);
    expect(isHarsh({ type: 'brake', tier: 1 })).toBe(false);
    expect(isHarsh({ type: 'shift', tier: 3 })).toBe(false);
    expect(isHarsh(null)).toBe(false);
  });
});

describe('longestCleanStreakMi', () => {
  it('is the whole drive when nothing harsh happened', () => {
    const s = drive(cruise(100));
    expect(longestCleanStreakMi(s, [])).toBeCloseTo(99 * 14 / MI, 1);
  });
  it('is the biggest gap between harsh events', () => {
    const s = drive(cruise(300));
    const ev = [{ type: 'brake', tier: 2, t: 60_000 }, { type: 'accel', tier: 3, t: 250_000 }];
    expect(longestCleanStreakMi(s, ev)).toBeCloseTo(190 * 14 / MI, 1);    // the 60 s → 250 s gap
  });
  it('ignores shift events and tier-1 noise', () => {
    const s = drive(cruise(100));
    const ev = [{ type: 'shift', tier: 3, t: 50_000 }, { type: 'brake', tier: 1, t: 60_000 }];
    expect(longestCleanStreakMi(s, ev)).toBeCloseTo(99 * 14 / MI, 1);
  });
  it('is 0 with no drive', () => { expect(longestCleanStreakMi([], [])).toBe(0); });
});

describe('clean streak', () => {
  it('grows with distance and resets on a hard brake, naming what it cost', () => {
    const s = drive(cruise(200));
    const li = createLiveInsights();
    const a = li.update(s.slice(0, 120), []);
    expect(a.streakMi).toBeCloseTo(119 * 14 / MI, 1);                      // ≈1.0 mi
    const ev = [{ type: 'brake', tier: 2, t: s[119].t }];
    const b = li.update(s.slice(0, 121), ev);
    expect(b.streakMi).toBeLessThan(0.05);
    const harsh = b.insights.find(i => i.kind === 'harsh');
    expect(harsh.tone).toBe('bad');
    expect(harsh.text).toMatch(/Hard brake — lost a 1\.0 mi streak/);
  });
  it('does not make a fuss about a streak that was never worth mentioning', () => {
    const s = drive(cruise(10));
    const li = createLiveInsights(); li.update(s.slice(0, 8), []);
    const r = li.update(s, [{ type: 'accel', tier: 2, t: s[9].t }]);
    expect(r.insights.find(i => i.kind === 'harsh').text).toBe('Hard launch.');
  });
  it('a shift event does not touch the streak', () => {
    const s = drive(cruise(100));
    const r = createLiveInsights().update(s, [{ type: 'shift', tier: 3, t: 50_000 }]);
    expect(r.streakMi).toBeCloseTo(99 * 14 / MI, 1);
    expect(kinds(r)).not.toContain('harsh');
  });
  it('works incrementally — same answer fed in pieces or all at once', () => {
    const s = drive(cruise(150)); const piece = createLiveInsights(); let last;
    for (let i = 10; i <= s.length; i += 10) last = piece.update(s.slice(0, i), []);
    expect(last.streakMi).toBeCloseTo(createLiveInsights().update(s, []).streakMi, 5);
  });
});

describe('milestones and personal best', () => {
  it('announces 0.5 and 1 mile once each, never repeats', () => {
    const s = drive(cruise(130)); const li = createLiveInsights(); const texts = [];
    for (let i = 5; i <= s.length; i += 5) texts.push(...li.update(s.slice(0, i), []).insights.filter(x => x.kind === 'milestone').map(x => x.text));
    expect(texts).toEqual(['0.5 mi clean.', '1 mile clean.']);
  });
  it('milestones restart after a streak is broken', () => {
    const s = drive(cruise(120)); const li = createLiveInsights();
    li.update(s.slice(0, 60), []);                                                 // past 0.5
    li.update(s.slice(0, 61), [{ type: 'brake', tier: 2, t: s[60].t }]);
    const r = li.update(s, [{ type: 'brake', tier: 2, t: s[60].t }]);              // a fresh ~0.5 mi later
    expect(r.insights.some(i => i.kind === 'milestone' && i.text === '0.5 mi clean.')).toBe(true);
  });
  it('flags a new best only when there was a real best to beat, and only once', () => {
    const s = drive(cruise(160)); const li = createLiveInsights({ bestMi: 1 }); const out = [];
    for (let i = 5; i <= s.length; i += 5) out.push(...li.update(s.slice(0, i), []).insights.filter(x => x.kind === 'best'));
    expect(out).toHaveLength(1);
    expect(out[0].text).toMatch(/New best streak — 1\.\d mi/);
  });
  it('does not cry "new best" on a driver with no history', () => {
    const r = run(cruise(160), [], { bestMi: 0 });
    expect(kinds(r.r)).not.toContain('best');
    expect(r.r.isNewBest).toBe(true);                                              // the bar still follows the streak
  });
  it('tracks the best as it grows', () => {
    const r = run(cruise(100), [], { bestMi: 0.3 });
    expect(r.r.bestMi).toBeCloseTo(r.r.streakMi, 5);
  });
});

describe('rolled it — slowed for a light but never stopped', () => {
  it('detects a dip to a crawl that carries on', () => {
    const r = run([...cruise(20), ...ramp(14, 2.5, 6), ...ramp(2.5, 14, 6), ...cruise(10)]);
    expect(kinds(r.r)).toContain('rolled');
    expect(r.li.rolled).toBe(1);
    expect(r.r.insights.find(i => i.kind === 'rolled').text).toBe('Rolled it — no stop.');
  });
  it('counts a near-stop that never held a full stop as rolled', () => {
    const r = run([...cruise(20), ...ramp(14, 0.2, 5), 0.2, ...ramp(0.2, 14, 5), ...cruise(10)]);   // under 1.5 s below 0.5 m/s
    expect(r.li.rolled).toBe(1);
  });
  it('a real full stop is NOT "rolled"', () => {
    const r = run([...cruise(20), ...ramp(14, 0, 8), ...Array(6).fill(0), ...ramp(0, 14, 6), ...cruise(10)]);
    expect(kinds(r.r)).not.toContain('rolled');
    expect(r.li.rolled).toBe(0);
  });
  it('merely easing off to a still-brisk pace is not a roll', () => {
    const r = run([...cruise(20), ...ramp(14, 5.5, 5), ...ramp(5.5, 14, 5), ...cruise(10)]);        // never below the slowing line
    expect(kinds(r.r)).not.toContain('rolled');
  });
  it('needs a real approach — crawling around a car park is not a roll', () => {
    const r = run([...cruise(10, 3), ...ramp(3, 1.5, 4), ...ramp(1.5, 3, 4), ...cruise(10, 3)]);
    expect(kinds(r.r)).not.toContain('rolled');
  });
  it('counts each one', () => {
    const dip = [...ramp(14, 2.5, 6), ...ramp(2.5, 14, 6), ...cruise(12)];
    expect(run([...cruise(15), ...dip, ...dip, ...dip]).li.rolled).toBe(3);
  });
});

describe('smooth stop', () => {
  it('rewards a long, gentle ease into a full stop', () => {
    const r = run([...cruise(20), ...ramp(14, 0, 10), ...Array(5).fill(0), ...ramp(0, 14, 6)]);
    const s = r.r.insights.find(i => i.kind === 'smooth-stop');
    expect(s).toBeTruthy();
    expect(s.text).toMatch(/Smooth stop — eased in over \d+s\./);
  });
  it('says nothing about a short, abrupt stop', () => {
    const r = run([...cruise(20), ...ramp(14, 0, 3), ...Array(5).fill(0), ...ramp(0, 14, 6)]);
    expect(kinds(r.r)).not.toContain('smooth-stop');
  });
  it('says nothing about a hard brake even if it took a while overall', () => {
    const sp = [...cruise(20), ...ramp(14, 12, 4), 4, ...ramp(4, 0, 2), ...Array(5).fill(0), ...ramp(0, 14, 6)];
    expect(kinds(run(sp).r)).not.toContain('smooth-stop');
  });
});

describe('insight feed — one message at a time, rarely', () => {
  const good = (text, priority = 3) => ({ kind: 'x', tone: 'good', priority, text });
  const bad  = (text) => ({ kind: 'harsh', tone: 'bad', priority: 5, text });

  it('shows a message, then expires it', () => {
    const f = createInsightFeed({ showMs: 4000 }); f.push(good('a'), 0);
    expect(f.current(0).text).toBe('a');
    expect(f.current(3999).text).toBe('a');
    expect(f.current(4001)).toBeNull();
  });
  it('spaces good news out (min gap)', () => {
    const f = createInsightFeed({ minGapMs: 7000, showMs: 3000 }); f.push(good('a'), 0); f.current(0);
    f.push(good('b'), 3500);
    expect(f.current(4000)).toBeNull();            // a expired, but b must wait for the gap
    expect(f.current(7100).text).toBe('b');
  });
  it('a hard input is shown straight away, even inside the gap and over good news', () => {
    const f = createInsightFeed({ minGapMs: 7000, showMs: 4500 }); f.push(good('a'), 0); f.current(0);
    f.push(bad('Hard brake.'), 1000);
    expect(f.current(1000).text).toBe('Hard brake.');
  });
  it('a hard input is not itself bumped by later good news', () => {
    const f = createInsightFeed(); f.push(bad('Hard brake.'), 0); f.current(0);
    f.push(good('nice', 5), 500);
    expect(f.current(1000).text).toBe('Hard brake.');
  });
  it('shows the most important queued message first', () => {
    const f = createInsightFeed(); f.push(good('minor', 2), 0); f.push(good('major', 4), 0);
    expect(f.current(0).text).toBe('major');
  });
  it('drops messages that went stale rather than showing them late', () => {
    const f = createInsightFeed({ minGapMs: 7000, staleMs: 15000 }); f.push(good('a'), 0); f.current(0);
    f.push(good('old'), 1000);
    expect(f.current(20000)).toBeNull();
  });
  it('keeps the queue short', () => {
    const f = createInsightFeed({ maxQueue: 2, minGapMs: 0 }); ['a', 'b', 'c', 'd'].forEach((t, i) => f.push(good(t, i), 0));
    const seen = []; for (let t = 0; t < 40000; t += 5000){ const c = f.current(t); if (c) seen.push(c.text); }
    expect(seen).toEqual(['d', 'c']);
  });
});

describe('ribbonSeries', () => {
  it('returns only the last window, x in [0,1], newest at 1', () => {
    const s = drive(cruise(200)); const now = s[199].t;
    const r = ribbonSeries(s, now, 90_000);
    expect(r[0].t).toBeGreaterThanOrEqual(now - 90_000);
    expect(r.every(p => p.x >= 0 && p.x <= 1)).toBe(true);
    expect(r[r.length - 1].x).toBe(1);
  });
  it('thins a dense window and always keeps the latest point', () => {
    const s = drive(cruise(600)); const now = s[599].t;
    const r = ribbonSeries(s, now, 600_000, 90);
    expect(r.length).toBeLessThanOrEqual(92);
    expect(r[r.length - 1].t).toBe(now);
  });
  it('is empty with no samples', () => { expect(ribbonSeries([], 0)).toEqual([]); });
  it('carries acceleration from either a live sample (longAccel) or a stored one (la)', () => {
    const r = ribbonSeries([{ t: 0, speed: 5, longAccel: 1.5 }, { t: 1000, speed: 5, la: -2 }], 1000, 5000);
    expect(r.map(p => p.la)).toEqual([1.5, -2]);
  });
});

describe('constants stay in step with scoring', () => {
  it('uses the same full-stop definition as the score (0.5 m/s for 1.5 s)', () => {
    expect(LIVE.STOP_MPS).toBe(0.5); expect(LIVE.STOP_MS).toBe(1500);
  });
});
