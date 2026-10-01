import { describe, it, expect, vi, beforeEach } from 'vitest';

// Force the non-native path so we exercise the web geolocation fallback.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: () => ({ addWatcher: vi.fn(), removeWatcher: vi.fn() }),
}));

const { startLocationWatch, stopLocationWatch, isBackgroundLocation } =
  await import('../services/sensors/location.js');

describe('location watch — web fallback', () => {
  let watchCb, errCb;
  beforeEach(() => {
    watchCb = null; errCb = null;
    global.navigator = global.navigator || {};
    navigator.geolocation = {
      watchPosition: vi.fn((ok, err) => { watchCb = ok; errCb = err; return 42; }),
      clearWatch: vi.fn(),
    };
  });

  it('reports it is not using background location off-native', () => {
    expect(isBackgroundLocation()).toBe(false);
  });

  it('starts a watchPosition and forwards fixes to onSample', async () => {
    const onSample = vi.fn();
    await startLocationWatch(onSample, () => {});
    expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(1);
    const pos = { coords: { latitude: 1, longitude: 2, speed: 9 }, timestamp: 100 };
    watchCb(pos);
    expect(onSample).toHaveBeenCalledWith(pos);
  });

  it('forwards errors to onError', async () => {
    const onError = vi.fn();
    await startLocationWatch(() => {}, onError);
    errCb({ code: 1, message: 'denied' });
    expect(onError).toHaveBeenCalledWith({ code: 1, message: 'denied' });
  });

  it('clears the web watch on stop', async () => {
    await startLocationWatch(() => {}, () => {});
    await stopLocationWatch();
    expect(navigator.geolocation.clearWatch).toHaveBeenCalledWith(42);
  });
});
