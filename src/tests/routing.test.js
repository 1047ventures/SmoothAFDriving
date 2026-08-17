import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// routing.js decides OSRM vs Mapbox from MAPBOX_TOKEN, which it reads once at
// import. To test both paths deterministically — rather than at the mercy of
// whether a local .env happens to hold a token — each block resets the module
// registry and mocks the constants so the provider is pinned, not ambient.
async function loadRouting({ token }){
  vi.resetModules();
  vi.doMock('../constants.js', async () => {
    const actual = await vi.importActual('../constants.js');
    return { ...actual, ROUTING_PROVIDER: 'mapbox', MAPBOX_TOKEN: token };
  });
  return import('../services/routing.js');
}

function mockFetch(payload, ok = true) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok, json: async () => payload,
  });
}

afterEach(() => { vi.restoreAllMocks(); vi.doUnmock('../constants.js'); });

// ── OSRM fallback: no token ─────────────────────────────────────────────────
describe('routing without a token (OSRM)', () => {
  let geocode, fetchRoute, isTrafficAware, etaBuffer;
  beforeEach(async () => { ({ geocode, fetchRoute, isTrafficAware, etaBuffer } = await loadRouting({ token: '' })); });

  it('geocodes through Nominatim', async () => {
    const spy = mockFetch([{ display_name: '1 Main St, Town', lat: '40.1', lon: '-74.2' }]);
    const out = await geocode('1 Main St');
    expect(spy.mock.calls[0][0]).toContain('nominatim.openstreetmap.org/search');
    expect(out).toEqual([{ label: '1 Main St, Town', lat: 40.1, lng: -74.2 }]);
  });

  it('routes through OSRM (lng,lat order)', async () => {
    const spy = mockFetch({
      routes: [{ distance: 5000, duration: 600, geometry: { coordinates: [[-74.2, 40.1], [-74.3, 40.2]] } }],
    });
    const out = await fetchRoute({ lat: 40.1, lng: -74.2 }, { lat: 40.2, lng: -74.3 });
    expect(spy.mock.calls[0][0]).toContain('/route/v1/driving/-74.2,40.1;-74.3,40.2');
    expect(out).toEqual({ distanceM: 5000, durationSec: 600, geometry: [[40.1, -74.2], [40.2, -74.3]] });
  });

  it('is not traffic-aware, so the ETA gets the full padding', () => {
    expect(isTrafficAware()).toBe(false);
    expect(etaBuffer()).toBe(1.2);
  });
});

// ── Mapbox: token present (production default) ──────────────────────────────
describe('routing with a token (Mapbox)', () => {
  let geocode, fetchRoute, isTrafficAware, etaBuffer;
  beforeEach(async () => { ({ geocode, fetchRoute, isTrafficAware, etaBuffer } = await loadRouting({ token: 'pk.test' })); });

  it('routes through the traffic-aware Mapbox profile', async () => {
    const spy = mockFetch({
      routes: [{ distance: 5000, duration: 600, geometry: { coordinates: [[-74.2, 40.1], [-74.3, 40.2]] } }],
    });
    const out = await fetchRoute({ lat: 40.1, lng: -74.2 }, { lat: 40.2, lng: -74.3 });
    expect(spy.mock.calls[0][0]).toContain('/directions/v5/mapbox/driving-traffic/');
    expect(spy.mock.calls[0][0]).toContain('access_token=pk.test');
    expect(out).toEqual({ distanceM: 5000, durationSec: 600, geometry: [[40.1, -74.2], [40.2, -74.3]] });
  });

  it('is traffic-aware, so the ETA is barely padded', () => {
    // This is the fix for "beat a 40-min drive by 14 minutes": a Mapbox ETA
    // already counts lights and congestion, so it must not get the 1.2 free-flow
    // padding on top.
    expect(isTrafficAware()).toBe(true);
    expect(etaBuffer()).toBe(1.05);
  });
});

// ── Behaviour that holds regardless of provider ─────────────────────────────
describe('routing edge cases', () => {
  let geocode, fetchRoute;
  beforeEach(async () => { ({ geocode, fetchRoute } = await loadRouting({ token: '' })); });

  it('returns null for a blank query, empty results, or a network error', async () => {
    expect(await geocode('')).toBeNull();
    mockFetch([]);
    expect(await geocode('nowhere')).toBeNull();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('net'));
    expect(await geocode('boom')).toBeNull();
  });

  it('returns null when there is no route or the request errors', async () => {
    mockFetch({ routes: [] });
    expect(await fetchRoute({ lat: 1, lng: 2 }, { lat: 3, lng: 4 })).toBeNull();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('net'));
    expect(await fetchRoute({ lat: 1, lng: 2 }, { lat: 3, lng: 4 })).toBeNull();
  });
});
