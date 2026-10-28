import { describe, it, expect } from 'vitest';
import { zoneFor, zoneScores, scoreState } from '../services/carZones.js';

const code = (c, severity = 'soon', pending = false) => ({ code: c, title: '', what: '', severity, pending, known: true });
const report = (codes = [], over = {}) => ({ checkedAt: 0, milOn: false, unread: 0, codes, status: 'clear', ...over });
const zone = (r, id, bat) => zoneScores(r, bat).zones.find(z => z.id === id);

describe('zoneFor', () => {
  it('maps generic powertrain ranges to parts of the car', () => {
    expect(zoneFor('P0171')).toBe('engine');
    expect(zoneFor('P0301')).toBe('engine');
    expect(zoneFor('P0420')).toBe('exhaust');
    expect(zoneFor('P0442')).toBe('exhaust');
    expect(zoneFor('P0562')).toBe('electrical');
    expect(zoneFor('P0620')).toBe('electrical');
    expect(zoneFor('P0A80')).toBe('electrical');
    expect(zoneFor('P0700')).toBe('transmission');
    expect(zoneFor('P0841')).toBe('transmission');
    expect(zoneFor('P0505')).toBe('engine');
  });
  it('maps P2, maker, chassis, body and network codes', () => {
    expect(zoneFor('P2096')).toBe('engine');
    expect(zoneFor('P2700')).toBe('transmission');
    expect(zoneFor('P2400')).toBe('exhaust');
    expect(zoneFor('P1450')).toBe('engine');
    expect(zoneFor('C0035')).toBe('brakes');
    expect(zoneFor('C0455')).toBe('steering');
    expect(zoneFor('B0100')).toBe('body');
    expect(zoneFor('U0100')).toBe('electrical');
  });
  it('handles the ranges the review caught', () => {
    expect(zoneFor('P2002')).toBe('exhaust');
    expect(zoneFor('P20EE')).toBe('exhaust');
    expect(zoneFor('P2004')).toBe('engine');
    expect(zoneFor('P2800')).toBe('transmission');
    expect(zoneFor('P0B00')).toBe('electrical');
    expect(zoneFor('P1700')).toBe('transmission');
    expect(zoneFor('P0571')).toBe('brakes');
    expect(zoneFor('C1435')).toBe('brakes');
    expect(zoneFor('C0550')).toBe('brakes');
  });
});

describe('zoneScores', () => {
  it('scores a clean scan 100 but leaves unscanned zones unread, not green', () => {
    const s = zoneScores(report());
    expect(s).toMatchObject({ overall: 100, read: 4, total: 7 });
    expect(zone(report(), 'engine')).toMatchObject({ read: true, score: 100, state: 'good', note: 'No faults' });
    expect(zone(report(), 'brakes')).toMatchObject({ read: false, score: null, state: null });
  });
  it('lights an unscanned zone once one of its codes turns up', () => {
    expect(zone(report([code('C0035')]), 'brakes')).toMatchObject({ read: true, score: 65, state: 'watch' });
  });
  it('never shows a part with a code as green', () => {
    expect(zone(report([code('P0420', 'watch', true)]), 'exhaust')).toMatchObject({ score: 79, state: 'watch' });
    expect(zone(report([code('B0100', 'watch')]), 'body')).toMatchObject({ score: 79, state: 'watch' });
  });
  it('costs a confirmed code more than an early warning', () => {
    expect(zone(report([code('P0301', 'urgent', true)]), 'engine').score).toBe(70);
    expect(zone(report([code('P0301', 'urgent')]), 'engine')).toMatchObject({ score: 40, state: 'bad' });
  });
  it('never drops below the floor', () => {
    const r = report([code('P0301', 'urgent'), code('P0302', 'urgent')]);
    expect(zone(r, 'engine').score).toBe(5);
  });
  it('keeps the overall in the worst zone\'s colour band', () => {
    expect(zoneScores(report([code('P0301', 'urgent')]))).toMatchObject({ overall: 45, overallState: 'bad' });
    expect(zoneScores(report([code('P0700')], { milOn: true }))).toMatchObject({ overall: 79, overallState: 'watch' });
  });
  it('blames the light on the engine only when no stored code explains it', () => {
    expect(zone(report([code('P0700')], { milOn: true }), 'engine').score).toBe(100);
  });
  it('marks the engine down for unread codes or an unexplained check-engine light', () => {
    expect(zone(report([], { unread: 2 }), 'engine')).toMatchObject({ score: 75, state: 'watch', note: 'codes stored' });
    expect(zone(report([], { milOn: true }), 'engine')).toMatchObject({ score: 75, note: 'check-engine light on' });
    expect(zone(report([code('P0171')], { milOn: true }), 'engine').score).toBe(65);
  });
  it('counts codes and early warnings in the note', () => {
    expect(zone(report([code('P0171'), code('P0174', 'soon', true)]), 'engine').note).toBe('1 code · 1 early warning');
  });
  it('folds the battery into Electrical', () => {
    const bat = { score: 70, state: 'watch', note: 'Battery 12.3 V' };
    expect(zone(report(), 'electrical', bat)).toMatchObject({ score: 70, state: 'watch', note: 'Battery 12.3 V' });
    expect(zone(report([code('P0562')]), 'electrical', bat).note).toBe('1 code · Battery 12.3 V');
  });
  it('lights only Electrical from a battery reading with no code scan', () => {
    const s = zoneScores(null, { score: 100, state: 'good', note: 'Battery 12.6 V' });
    expect(s).toMatchObject({ overall: 100, read: 1 });
    expect(s.zones.find(z => z.id === 'engine')).toMatchObject({ read: false, note: 'Needs a scan with the ignition on' });
  });
  it('returns null without a report', () => {
    expect(zoneScores(null)).toBeNull();
  });
});

describe('scoreState', () => {
  it('bands green / yellow / red', () => {
    expect([scoreState(80), scoreState(79), scoreState(50), scoreState(49)]).toEqual(['good', 'watch', 'watch', 'bad']);
  });
});
