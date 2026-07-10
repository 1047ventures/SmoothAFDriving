import { describe, it, expect, vi, afterEach } from 'vitest';
import { geocode, fetchRoute } from '../services/routing.js';

afterEach(() => { vi.restoreAllMocks(); });

function mockFetch(payload, ok = true) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok, json: async () => payload,
  });
}

describe('geocode', () => {
  it('builds a Nominatim URL and parses results', async () => {
    const spy = mockFetch([
      { display_name: '1 Main St, Town', lat: '40.1', lon: '-74.2' },
      { display_name: '1 Main St, Other', lat: '41.0', lon: '-75.0' },
    ]);
    const out = await geocode('1 Main St');
    expect(spy.mock.calls[0][0]).toContain('nominatim.openstreetmap.org/search');
    expect(spy.mock.calls[0][0]).toContain('q=1%20Main%20St');
    expect(out).toEqual([
      { label: '1 Main St, Town', lat: 40.1, lng: -74.2 },
      { label: '1 Main St, Other', lat: 41.0, lng: -75.0 },
    ]);
  });
  it('returns null for blank query, empty results, or errors', async () => {
    expect(await geocode('')).toBeNull();
    mockFetch([]);
    expect(await geocode('nowhere')).toBeNull();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('net'));
    expect(await geocode('boom')).toBeNull();
  });
});

describe('fetchRoute', () => {
  it('builds an OSRM URL (lng,lat order) and parses the route', async () => {
    const spy = mockFetch({
      routes: [{
        distance: 5000, duration: 600,
        geometry: { coordinates: [[-74.2, 40.1], [-74.3, 40.2]] },
      }],
    });
    const out = await fetchRoute({ lat: 40.1, lng: -74.2 }, { lat: 40.2, lng: -74.3 });
    expect(spy.mock.calls[0][0]).toContain('/route/v1/driving/-74.2,40.1;-74.3,40.2');
    expect(out).toEqual({
      distanceM: 5000,
      durationSec: 600,
      geometry: [[40.1, -74.2], [40.2, -74.3]],
    });
  });
  it('returns null when no route or on error', async () => {
    mockFetch({ routes: [] });
    expect(await fetchRoute({ lat: 1, lng: 2 }, { lat: 3, lng: 4 })).toBeNull();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('net'));
    expect(await fetchRoute({ lat: 1, lng: 2 }, { lat: 3, lng: 4 })).toBeNull();
  });
});
