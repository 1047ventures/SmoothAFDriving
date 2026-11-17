// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.stubGlobal('localStorage', { getItem: () => null, setItem(){}, removeItem(){}, clear(){} });

/**
 * updateLiveUI is the 5×/s heartbeat of the record screen. It only runs while a
 * drive is recording, so nothing else in the suite executes it — a deleted
 * local shipped a ReferenceError that threw on every tick of every drive while
 * the build was clean and 724 tests passed.
 *
 * This runs it for real against the record-screen markup.
 */
const S = await import('../state.js');
const { state, resetState } = S;
const { updateLiveUI } = await import('../ui/record.js');

function recordScreenMarkup(){
  // Everything updateLiveUI writes to, plus the HUD elements it drives.
  const ids = ['live-speed','live-time','live-avg-speed','live-g',
               'live-score','score-delta','live-stops','live-rolled',
               'rec-source','rec-elapsed','rec-dist','arc-progress','arc-svg',
               'pace-strip','rec-avatar','btn-stop'];
  document.body.innerHTML = ids.map(i => `<div id="${i}"></div>`).join('')
    + '<canvas id="inputs-ribbon"></canvas>';
}

function seedDrive({ samples = 30, speed = 27 } = {}){
  resetState();
  state.recording = true;
  state.startTime = Date.now() - samples * 1000;
  state.samples = Array.from({ length: samples }, (_, i) => ({
    t: state.startTime + i * 1000,
    lat: 39.74 + i * 1e-5, lon: -104.99,
    speed, heading: 90, harshness: 0.3,
    longAccel: 0.2, latAccel: 0.1, distMeters: speed,
  }));
  state.events = [];
  state.lastGpsPos = state.samples[state.samples.length - 1];
  state.distanceMeters = samples * speed;
}

beforeEach(() => { recordScreenMarkup(); });

describe('the live tick survives a real drive', () => {
  it('does not throw mid-drive', () => {
    seedDrive();
    expect(() => updateLiveUI()).not.toThrow();
  });

  it('does not throw on the very first sample', () => {
    seedDrive({ samples: 1 });
    expect(() => updateLiveUI()).not.toThrow();
  });

  it('does not throw before any GPS has arrived', () => {
    // The window between tapping start and the first fix, where `last` is undefined.
    seedDrive({ samples: 0 });
    state.samples = [];
    state.lastGpsPos = null;
    expect(() => updateLiveUI()).not.toThrow();
  });

  it('does not throw while stopped at a light', () => {
    seedDrive({ speed: 0 });
    expect(() => updateLiveUI()).not.toThrow();
  });

  it('paints the speed from the newest sample', () => {
    seedDrive({ speed: 27 });
    updateLiveUI();
    expect(Number(document.getElementById('live-speed').textContent)).toBe(60); // 27 m/s
  });

  it('keeps ticking across many calls', () => {
    seedDrive();
    expect(() => { for (let i = 0; i < 20; i++) updateLiveUI(); }).not.toThrow();
  });
});
