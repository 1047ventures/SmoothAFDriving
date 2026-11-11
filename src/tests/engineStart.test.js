import { describe, it, expect } from 'vitest';
import { createEngineStartMonitor } from '../services/engineStart.js';

// 1 Hz timeline. Each phase: { secs, rpm, linked = true, answered = true, recording = false }.
// Returns the seconds (from the start) at which a drive start fired.
function run(phases, m = createEngineStartMonitor()){
  let t = 1_000_000; const fired = [];
  for (const p of phases){
    for (let i = 0; i < p.secs; i++, t += 1000){
      const answered = p.answered !== false && p.linked !== false;
      if (m.tick({ now: t, linked: p.linked !== false, rpm: p.rpm ?? null, rpmAt: answered ? t : t - 60_000, recording: !!p.recording })) fired.push((t - 1_000_000) / 1000);
    }
  }
  return { fired, m };
}

describe('engine start → drive start', () => {
  it('fires once, about 2 s after the engine settles at idle', () => {
    const { fired } = run([{ secs: 5, rpm: 0 }, { secs: 60, rpm: 720 }]);
    expect(fired).toEqual([7]);
  });

  it('ignores a crank that stalls straight away', () => {
    const { fired } = run([{ secs: 5, answered: false }, { secs: 1, rpm: 900 }, { secs: 10, rpm: 0 }]);
    expect(fired).toEqual([]);
  });

  it('fires when the app links to a car that is already running', () => {
    const { fired } = run([{ secs: 10, rpm: 750 }]);
    expect(fired).toEqual([2]);
  });

  it('never fires while a drive is recording, and not again after it until the engine goes off', () => {
    const { fired } = run([
      { secs: 30, rpm: 2000, recording: true },
      { secs: 30, rpm: 750 },                       // drive ended at the pump, engine still running
    ]);
    expect(fired).toEqual([]);
  });

  it('re-arms once the engine is off for 3 s, then fires on the next start', () => {
    const { fired } = run([
      { secs: 10, rpm: 750 },                       // fires at 2
      { secs: 20, rpm: 750 },                       // still the same run: nothing
      { secs: 5, answered: false },                 // switched off: the computer goes quiet
      { secs: 10, rpm: 760 },                       // started again
    ]);
    expect(fired).toEqual([2, 37]);
  });

  it('a cancelled countdown stays cancelled for that engine run', () => {
    const r = run([{ secs: 5, rpm: 750 }]);
    expect(r.fired).toEqual([2]);
    expect(run([{ secs: 60, rpm: 750 }], r.m).fired).toEqual([]);
  });

  it('does not re-arm at a start-stop light during a drive, so a drive ended there is not restarted', () => {
    const { fired } = run([
      { secs: 30, rpm: 2000, recording: true },
      { secs: 40, rpm: 0, recording: true },        // start-stop at a light
      { secs: 20, rpm: 0 },                         // the drive ended there
      { secs: 10, rpm: 800 },                       // engine restarts as the light turns green
    ]);
    expect(fired).toEqual([]);
  });

  it('a car that keeps answering 0 after it is switched off re-arms after a minute', () => {
    const { fired } = run([{ secs: 5, rpm: 750 }, { secs: 70, rpm: 0 }, { secs: 5, rpm: 750 }]);
    expect(fired).toEqual([2, 77]);
  });

  it('a blocked or interrupted start can fire again', () => {
    const r = run([{ secs: 5, rpm: 750 }]);
    r.m.rearm();
    expect(run([{ secs: 5, rpm: 750 }], r.m).fired).toEqual([2]);
  });

  it('a dropped link counts as a new engine run', () => {
    const r = run([{ secs: 5, rpm: 750 }]);
    r.m.linkLost();
    expect(run([{ secs: 5, rpm: 750 }], r.m).fired).toEqual([2]);
  });
});
