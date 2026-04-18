// ELM327 OBD-II protocol helpers

export const ELM_INIT_SEQUENCE = [
  "AT Z",   // reset
  "AT E0",  // echo off
  "AT L0",  // linefeeds off
  "AT H0",  // headers off
  "AT S0",  // spaces off
  "AT SP 0", // auto-detect protocol
];

export interface OBDPid {
  pid: string;
  name: string;
  unit: string;
  parse: (hex: string) => number | null;
}

export const PIDS: Record<string, OBDPid> = {
  RPM: {
    pid: "010C",
    name: "Engine RPM",
    unit: "rpm",
    parse: (hex) => {
      const bytes = hex.trim().split(/\s+/);
      if (bytes.length < 2) return null;
      const A = parseInt(bytes[0], 16);
      const B = parseInt(bytes[1], 16);
      return ((A * 256) + B) / 4;
    },
  },
  SPEED: {
    pid: "010D",
    name: "Vehicle Speed",
    unit: "km/h",
    parse: (hex) => {
      const byte = hex.trim().split(/\s+/)[0];
      return parseInt(byte, 16);
    },
  },
  THROTTLE: {
    pid: "0111",
    name: "Throttle Position",
    unit: "%",
    parse: (hex) => {
      const byte = hex.trim().split(/\s+/)[0];
      return (parseInt(byte, 16) * 100) / 255;
    },
  },
  COOLANT_TEMP: {
    pid: "0105",
    name: "Coolant Temp",
    unit: "°C",
    parse: (hex) => {
      const byte = hex.trim().split(/\s+/)[0];
      return parseInt(byte, 16) - 40;
    },
  },
  FUEL_LEVEL: {
    pid: "012F",
    name: "Fuel Level",
    unit: "%",
    parse: (hex) => {
      const byte = hex.trim().split(/\s+/)[0];
      return (parseInt(byte, 16) * 100) / 255;
    },
  },
  ENGINE_LOAD: {
    pid: "0104",
    name: "Engine Load",
    unit: "%",
    parse: (hex) => {
      const byte = hex.trim().split(/\s+/)[0];
      return (parseInt(byte, 16) * 100) / 255;
    },
  },
  INTAKE_TEMP: {
    pid: "010F",
    name: "Intake Air Temp",
    unit: "°C",
    parse: (hex) => {
      const byte = hex.trim().split(/\s+/)[0];
      return parseInt(byte, 16) - 40;
    },
  },
};

export interface DTCInfo {
  code: string;
  description: string;
  severity: "low" | "medium" | "high";
  system: string;
}

// Partial DTC lookup — AI concierge supplements with full descriptions
export const COMMON_DTC: Record<string, Omit<DTCInfo, "code">> = {
  P0300: { description: "Random/Multiple Cylinder Misfire", severity: "high", system: "Engine" },
  P0420: { description: "Catalyst System Efficiency Below Threshold (Bank 1)", severity: "medium", system: "Emissions" },
  P0171: { description: "System Too Lean (Bank 1)", severity: "medium", system: "Fuel" },
  P0174: { description: "System Too Lean (Bank 2)", severity: "medium", system: "Fuel" },
  P0401: { description: "EGR Flow Insufficient", severity: "low", system: "Emissions" },
  P0442: { description: "EVAP Small Leak", severity: "low", system: "Emissions" },
  P0455: { description: "EVAP Large Leak / Loose Gas Cap", severity: "low", system: "Emissions" },
  P0128: { description: "Coolant Temperature Below Thermostat Regulating Temp", severity: "low", system: "Cooling" },
  P0340: { description: "Camshaft Position Sensor Circuit Malfunction", severity: "high", system: "Engine" },
  P0011: { description: "Camshaft Position Timing Over-Advanced (Bank 1)", severity: "high", system: "Engine" },
  P0135: { description: "O2 Sensor Heater Circuit Malfunction (Bank 1, Sensor 1)", severity: "medium", system: "Emissions" },
  P0301: { description: "Cylinder 1 Misfire", severity: "high", system: "Engine" },
  P0302: { description: "Cylinder 2 Misfire", severity: "high", system: "Engine" },
  P0303: { description: "Cylinder 3 Misfire", severity: "high", system: "Engine" },
  P0304: { description: "Cylinder 4 Misfire", severity: "high", system: "Engine" },
};

export function parseDTCResponse(raw: string): string[] {
  // ELM327 response: "43 01 43 00 00 00 00\r\n>" or similar
  const clean = raw.replace(/[^0-9A-Fa-f\s]/g, "").trim();
  const bytes = clean.split(/\s+/).filter(Boolean);
  if (bytes.length < 2) return [];

  const codes: string[] = [];
  for (let i = 0; i < bytes.length - 1; i += 2) {
    const high = parseInt(bytes[i], 16);
    const low = parseInt(bytes[i + 1], 16);
    if (high === 0 && low === 0) continue;

    const systemBits = (high >> 6) & 0x03;
    const systemChar = ["P", "C", "B", "U"][systemBits];
    const digit2 = (high >> 4) & 0x03;
    const digit3 = high & 0x0f;
    const digit4 = (low >> 4) & 0x0f;
    const digit5 = low & 0x0f;
    codes.push(`${systemChar}${digit2}${digit3}${digit4.toString(16).toUpperCase()}${digit5.toString(16).toUpperCase()}`);
  }
  return codes;
}

export function lookupDTC(code: string): DTCInfo {
  const base = COMMON_DTC[code];
  if (base) return { code, ...base };
  return {
    code,
    description: "Unknown fault — ask your AI concierge for details",
    severity: "medium",
    system: "Unknown",
  };
}
