import { describe, it, expect } from 'vitest';
import { createAutoEndMonitor, trimDriveTail, AUTO_END } from '../services/autoEnd.js';

// Drive the monitor on a 1 Hz timeline. Each phase: { secs, linked, rpm, speed } — the monitor
// sees fresh OBD + GPS every second. Returns the first end decision and the second it fired.
function run(phases, { monitor = createAutoEndMonitor(), startAt = 1_000_000 } = {}){
  let t = startAt;
  for (const p of phases){
    for (let i = 0; i < p.secs; i++, t += 1000){
      const r = monitor.tick({
        now: t, linked: p.linked, rpm: p.rpm ?? null,
        obdAt: p.linked ? t : null,                     // an unlinked adapter produces no readings
        gpsSpeedMps: p.speed, gpsAt: p.gps === false ? null : t,
      });
      if (r) return { ...r, at: t, elapsed: (t - startAt) / 1000, monitor };
    }
  }
  return { ended: false, monitor };
}
const driving = (secs, extra = {}) => ({ secs, linked: true, rpm: 2200, speed: 14, ...extra });

describe('auto-end: engine off with the dongle connected', () => {
  it('ends ~30 s after the adapter loses power while the car is parked', () => {
    const r = run([driving(120), { secs: 60, linked: false, speed: 0 }]);
    expect(r.reason).toBe('link-lost');
    expect(r.elapsed).toBeGreaterThanOrEqual(120 + 30);
    expect(r.elapsed).toBeLessThanOrEqual(120 + 32);
  });

  it('reports when the car came to REST so the idle tail can be trimmed', () => {
    const startAt = 1_000_000;
    const r = run([driving(120), { secs: 60, linked: false, speed: 0 }], { startAt });
    expect(r.restAt).toBe(startAt + 120 * 1000);          // the first stationary fix
  });

  it('ends on engine-off when the adapter stays powered but RPM reads 0, after 150 s parked', () => {
    const r = run([driving(60), { secs: 400, linked: true, rpm: 0, speed: 0 }]);
    expect(r.reason).toBe('engine-off');
    expect(r.elapsed).toBeGreaterThanOrEqual(60 + 150);
    expect(r.elapsed).toBeLessThanOrEqual(60 + 152);
  });
});

describe('auto-end: must NOT end a live drive', () => {
  it('never arms without a dongle: a parked car with no OBD is left alone', () => {
    const r = run([{ secs: 3600, linked: false, rpm: null, speed: 0 }]);
    expect(r.ended).toBe(false);
  });

  it('never arms if the adapter never reads an engine running (RPM stays 0/null)', () => {
    const r = run([{ secs: 600, linked: true, rpm: 0, speed: 0 }]);
    expect(r.ended).toBe(false);
  });

  it('ignores a Bluetooth drop while the car is still moving, however long it lasts', () => {
    const r = run([driving(120), { secs: 900, linked: false, speed: 22 }]);
    expect(r.ended).toBe(false);
  });

  it('a brief link drop at a red light that recovers does not end the drive', () => {
    const r = run([driving(120), { secs: 20, linked: false, speed: 0 }, { secs: 300, linked: true, rpm: 800, speed: 0 }]);
    expect(r.ended).toBe(false);
  });

  it('link lost, then the car drives off again before the grace expires: no end', () => {
    const r = run([driving(120), { secs: 20, linked: false, speed: 0 }, { secs: 600, linked: false, speed: 12 }]);
    expect(r.ended).toBe(false);
  });

  it('stop-start cars: engine off at a long red light (RPM 0, adapter alive) does not end the drive', () => {
    const r = run([driving(120), { secs: 100, linked: true, rpm: 0, speed: 0 }, driving(200)]);
    expect(r.ended).toBe(false);
  });

  it('a stalled engine while still coasting (RPM 0, speed > 0) waits until the car actually stops', () => {
    const r = run([driving(60), { secs: 300, linked: true, rpm: 0, speed: 8 }]);
    expect(r.ended).toBe(false);
  });

  it('the parked clock starts when the CAR stops, not when the link dropped earlier', () => {
    // Link lost while moving, car keeps moving 100 s, then parks. Ends 30 s after parking.
    const r = run([driving(60), { secs: 100, linked: false, speed: 15 }, { secs: 120, linked: false, speed: 0 }]);
    expect(r.reason).toBe('link-lost');
    expect(r.elapsed).toBeGreaterThanOrEqual(60 + 100 + 30);
    expect(r.elapsed).toBeLessThanOrEqual(60 + 100 + 32);
  });
});

describe('auto-end: stale data is not evidence', () => {
  it('a stale GPS fix does not count as "parked"', () => {
    const r = run([driving(60), { secs: 600, linked: false, speed: 0, gps: false }]);
    expect(r.ended).toBe(false);
  });

  it('a stale OBD reading does not count as RPM 0', () => {
    const monitor = createAutoEndMonitor();
    run([driving(30)], { monitor });
    let t = 2_000_000, out = null;
    for (let i = 0; i < 400 && !out; i++, t += 1000){
      out = monitor.tick({ now: t, linked: true, rpm: 0, obdAt: t - 60_000, gpsSpeedMps: 0, gpsAt: t });
    }
    expect(out).toBeNull();
  });
});

describe('trimDriveTail', () => {
  it('drops samples and events recorded after the car came to rest', () => {
    const st = {
      samples: [{ t: 100 }, { t: 200 }, { t: 300 }, { t: 400 }],
      events:  [{ t: 150 }, { t: 350 }],
    };
    trimDriveTail(st, 250);
    expect(st.samples.map(s => s.t)).toEqual([100, 200]);
    expect(st.events.map(e => e.t)).toEqual([150]);
  });

  it('is a no-op without a cut-off', () => {
    const st = { samples: [{ t: 1 }], events: [] };
    trimDriveTail(st, null);
    expect(st.samples).toHaveLength(1);
  });

  it('keeping TAIL_KEEP_MS of the stop itself leaves the arrival in the drive', () => {
    expect(AUTO_END.TAIL_KEEP_MS).toBeGreaterThan(0);
  });
});
