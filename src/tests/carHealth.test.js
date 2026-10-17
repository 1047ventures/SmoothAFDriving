import { describe, it, expect } from 'vitest';
import { decodeDtc, parseDtcResponse, parseMilStatus, buildReport, reportHeadline, explainCode } from '../services/carHealth.js';

describe('decodeDtc', () => {
  it('decodes the four systems', () => {
    expect(decodeDtc(0x01, 0x33)).toBe('P0133');
    expect(decodeDtc(0x03, 0x01)).toBe('P0301');
    expect(decodeDtc(0x41, 0x23)).toBe('C0123');
    expect(decodeDtc(0x81, 0x00)).toBe('B0100');
    expect(decodeDtc(0xC1, 0x55)).toBe('U0155');
    expect(decodeDtc(0x14, 0x20)).toBe('P1420');
  });
  it('treats 0000 as padding', () => {
    expect(decodeDtc(0, 0)).toBeNull();
  });
});

describe('parseDtcResponse', () => {
  it('reads a legacy (non-CAN) reply with padding', () => {
    expect(parseDtcResponse('43 01 33 03 01 00 00\r\r>')).toEqual(['P0133', 'P0301']);
  });
  it('reads legacy replies with spaces off across lines', () => {
    expect(parseDtcResponse('430133030104 20\r43017100000000\r>')).toEqual(['P0133', 'P0301', 'P0420', 'P0171']);
  });
  it('reads a CAN single-frame reply', () => {
    expect(parseDtcResponse('43020133 0234\r>')).toEqual(['P0133', 'P0234']);
  });
  it('reads a CAN reply with no codes', () => {
    expect(parseDtcResponse('4300\r>')).toEqual([]);
  });
  it('reassembles a CAN multi-frame reply', () => {
    const raw = '00B\r0:43040133030104\r1:200171AAAAAAAA\r\r>';
    expect(parseDtcResponse(raw)).toEqual(['P0133', 'P0301', 'P0420', 'P0171']);
  });
  it('merges answers from two ECUs without duplicates', () => {
    expect(parseDtcResponse('43010420\r43020420 0700\r>')).toEqual(['P0420', 'P0700']);
  });
  it('reads Mode 07 pending replies', () => {
    expect(parseDtcResponse('47010442\r>', '07')).toEqual(['P0442']);
  });
  it('NO DATA means no codes; adapter errors mean unknown', () => {
    expect(parseDtcResponse('NO DATA\r>')).toEqual([]);
    expect(parseDtcResponse('UNABLE TO CONNECT\r>')).toBeNull();
    expect(parseDtcResponse('?\r>')).toBeNull();
  });
  it('ignores SEARCHING... preamble', () => {
    expect(parseDtcResponse('SEARCHING...\r43010301\r>')).toEqual(['P0301']);
  });
});

describe('parseMilStatus', () => {
  it('reads light on + count', () => {
    expect(parseMilStatus('4101 83 07 65 04\r>')).toEqual({ milOn: true, count: 3 });
  });
  it('reads light off', () => {
    expect(parseMilStatus('410100076504')).toEqual({ milOn: false, count: 0 });
  });
  it('returns null on garbage', () => {
    expect(parseMilStatus('NO DATA')).toBeNull();
  });
});

describe('buildReport', () => {
  it('is clear when the car answered with nothing', () => {
    const r = buildReport({ milRaw: '410100076504\r>', storedRaw: '4300\r>', pendingRaw: '4700\r>' }, 1);
    expect(r.status).toBe('clear');
    expect(reportHeadline(r)).toBe('No trouble codes');
  });
  it('sorts urgent first and keeps pending separate', () => {
    const r = buildReport({ milRaw: '410182\r>', storedRaw: '43020420 0301\r>', pendingRaw: '47020442 0420\r>' });
    expect(r.codes.map(c => [c.code, c.pending])).toEqual([['P0301', false], ['P0420', false], ['P0442', true]]);
    expect(r.status).toBe('attention');
    expect(reportHeadline(r)).toBe('2 codes · 1 early warning');
  });
  it('pending-only is a watch, not an alarm', () => {
    const r = buildReport({ milRaw: '410100\r>', storedRaw: '4300\r>', pendingRaw: '47010171\r>' });
    expect(r.status).toBe('watch');
    expect(reportHeadline(r)).toBe('1 early warning');
  });
  it('returns null when the car never answered', () => {
    expect(buildReport({ milRaw: '', storedRaw: 'UNABLE TO CONNECT', pendingRaw: '?' })).toBeNull();
  });
});

describe('explainCode', () => {
  it('uses the table when known', () => {
    expect(explainCode('P0457').severity).toBe('watch');
    expect(explainCode('P0522').severity).toBe('soon');
    expect(explainCode('P0524').severity).toBe('urgent');
    expect(explainCode('P0301').severity).toBe('urgent');
  });
  it('falls back honestly for unknown and maker codes', () => {
    const e = explainCode('P1234');
    expect(e.known).toBe(false);
    expect(e.what).toMatch(/manufacturer-specific/);
    expect(explainCode('U0100').title).toMatch(/Network/);
  });
});

describe('honesty under failure (review findings)', () => {
  it('a timed-out or dropped read is unknown, never clear', () => {
    expect(parseDtcResponse('')).toBeNull();
    expect(parseDtcResponse('4300')).toBeNull();           // no prompt = partial
    expect(buildReport({ milRaw: '', storedRaw: '', pendingRaw: '' })).toBeNull();
    expect(buildReport({ milRaw: '410100\r>', storedRaw: '', pendingRaw: '4700\r>' })).toBeNull();
  });
  it('reads the light from every ECU that answers', () => {
    expect(parseMilStatus('410100076504\r410183076504\r>')).toEqual({ milOn: true, count: 3 });
  });
  it('keeps both ECUs when two multi-frame blocks arrive', () => {
    const raw = '00B\r0:43040133023401\r1:710300AAAAAAAA\r00B\r0:43040420010000\r1:000000AAAAAAAA\r>';
    expect(parseDtcResponse(raw)).toEqual(['P0133', 'P0234', 'P0171', 'P0300', 'P0420', 'P0100']);
  });
  it('drops error-tagged and misshapen lines instead of inventing codes', () => {
    expect(parseDtcResponse('43013300000000<DATAERROR\r>')).toEqual([]);
    expect(parseDtcResponse('4301330234\r>')).toEqual([]);   // 5 bytes: fits neither shape
    expect(parseDtcResponse('1:340171\r>')).toEqual([]);     // orphan continuation frame
  });
  it('stored codes the car would not list are never called clear', () => {
    const r = buildReport({ milRaw: '410102\r>', storedRaw: '4300\r>', pendingRaw: '4700\r>' });
    expect(r.status).toBe('watch');
    expect(reportHeadline(r)).toBe('2 codes stored');
  });
});
