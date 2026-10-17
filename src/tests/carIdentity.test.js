import { describe, it, expect } from 'vitest';
import { parseVinResponse, modelYear, checkDigitOk, wmiMake, vehicleTypeFrom, fromVpic, decodeVin, carLabel } from '../services/carIdentity.js';

const VIN = '1HGCM82633A004352';   // valid check digit (classic example VIN)
const asciiHex = s => [...s].map(c => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join('');

describe('parseVinResponse', () => {
  it('reads a CAN multi-frame reply', () => {
    const h = '490201' + asciiHex(VIN);                 // 3 + 17 = 20 bytes
    const frames = ['014', '0:' + h.slice(0, 12), '1:' + h.slice(12, 26), '2:' + h.slice(26, 40)];
    expect(parseVinResponse(frames.join('\r') + '\r\r>')).toBe(VIN);
  });
  it('reads a legacy five-line reply (out of order, padded)', () => {
    const data = '000000' + asciiHex(VIN);              // 3 zero bytes + 17 = 20 bytes = 5 × 4
    const lines = [0, 1, 2, 3, 4].map(k => '4902' + String(k + 1).padStart(2, '0') + data.slice(k * 8, k * 8 + 8));
    expect(parseVinResponse([lines[2], lines[0], lines[4], lines[1], lines[3]].join('\r') + '\r>')).toBe(VIN);
  });
  it('rejects timeouts, errors and garbage', () => {
    expect(parseVinResponse('')).toBeNull();
    expect(parseVinResponse('NO DATA\r>')).toBeNull();
    expect(parseVinResponse('0:4902013132\r>')).toBeNull();   // too short
    // 17 chars but contains an O — not a VIN
    expect(parseVinResponse('490201' + asciiHex('1HGCM82633AO04352') + '\r>')).toBeNull();
  });
});

describe('offline decode', () => {
  const now = new Date('2026-10-16');
  it('reads the model year across cycles', () => {
    expect(modelYear(VIN, now)).toBe(2003);                    // '3', pos7 digit
    expect(modelYear('1HGFC2F69KH512345', now)).toBe(2019);    // 'K', pos7 letter
    expect(modelYear('WBA8E9C51KA123456', now)).toBe(2019);    // 'K', pos7 digit → can't be 1989
    expect(modelYear('1FTDF17W2TN000000', now)).toBe(1996);    // 'T', pos7 digit
    expect(modelYear('5YJ3E1EA0TF000000', now)).toBe(2026);    // 'T', pos7 letter
  });
  it('checks the check digit', () => {
    expect(checkDigitOk(VIN)).toBe(true);
    expect(checkDigitOk('1HGCM82623A004352')).toBe(false);
  });
  it('knows common makers', () => {
    expect(wmiMake('5YJ3E1EA0TF000000')).toBe('Tesla');
    expect(wmiMake('ZZZ00000000000000')).toBeNull();
  });
});

describe('vPIC mapping', () => {
  it('maps body classes to garage types', () => {
    expect(vehicleTypeFrom({ BodyClass: 'Pickup' })).toBe('truck');
    expect(vehicleTypeFrom({ BodyClass: 'Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)' })).toBe('suv');
    expect(vehicleTypeFrom({ BodyClass: 'Sedan/Saloon', ElectrificationLevel: 'BEV (Battery Electric Vehicle)' })).toBe('electric');
    expect(vehicleTypeFrom({ BodyClass: 'Hatchback/Liftback/Notchback' })).toBe('hatchback');
  });
  it('builds a garage-shaped car', () => {
    const c = fromVpic('1HGFC2F69KH512345', { Make: 'HONDA', Model: 'Civic', ModelYear: '2019', Trim: 'LX', BodyClass: 'Sedan/Saloon' });
    expect(c).toMatchObject({ make: 'Honda', model: 'Civic', year: '2019', trim: 'LX', type: 'sedan' });
    expect(carLabel(c)).toBe('2019 Honda Civic LX');
  });
  it('falls back offline when the lookup fails', async () => {
    const c = await decodeVin('1HGFC2F69KH512345', { fetchImpl: () => Promise.reject(new Error('offline')) });
    expect(c).toMatchObject({ make: 'Honda', year: '2019', model: '' });
  });
});
