import { useState, useRef, useCallback } from "react";
import { ELM_INIT_SEQUENCE, PIDS, parseDTCResponse, lookupDTC, DTCInfo } from "@/lib/obdProtocol";

export type OBDStatus = "disconnected" | "connecting" | "connected" | "error";

export interface OBDData {
  speed?: number;
  rpm?: number;
  throttle?: number;
  coolantTemp?: number;
  fuelLevel?: number;
  engineLoad?: number;
  intakeTemp?: number;
}

const ELM327_SERVICE_UUID = "0000fff0-0000-1000-8000-00805f9b34fb";
const ELM327_CHAR_WRITE = "0000fff1-0000-1000-8000-00805f9b34fb";
const ELM327_CHAR_NOTIFY = "0000fff2-0000-1000-8000-00805f9b34fb";

export function useOBD() {
  const [obdStatus, setOBDStatus] = useState<OBDStatus>("disconnected");
  const [obdData, setOBDData] = useState<OBDData>({});
  const [dtcCodes, setDtcCodes] = useState<DTCInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const deviceRef = useRef<BluetoothDevice | null>(null);
  const charWriteRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const responseBufferRef = useRef<string>("");
  const pendingResolveRef = useRef<((res: string) => void) | null>(null);

  const handleNotification = useCallback((event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;
    const chunk = new TextDecoder().decode(value);
    responseBufferRef.current += chunk;
    if (responseBufferRef.current.includes(">") && pendingResolveRef.current) {
      const response = responseBufferRef.current.replace(">", "").trim();
      responseBufferRef.current = "";
      const resolve = pendingResolveRef.current;
      pendingResolveRef.current = null;
      resolve(response);
    }
  }, []);

  const sendCommand = useCallback((cmd: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!charWriteRef.current) { reject(new Error("Not connected")); return; }
      pendingResolveRef.current = resolve;
      const encoded = new TextEncoder().encode(cmd + "\r");
      charWriteRef.current.writeValue(encoded).catch(reject);
      setTimeout(() => {
        if (pendingResolveRef.current === resolve) {
          pendingResolveRef.current = null;
          reject(new Error("OBD timeout"));
        }
      }, 5000);
    });
  }, []);

  const connect = useCallback(async () => {
    if (!("bluetooth" in navigator)) {
      setError("Web Bluetooth not supported on this browser/device");
      setOBDStatus("error");
      return;
    }
    try {
      setOBDStatus("connecting");
      setError(null);

      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: "ELM" }, { namePrefix: "OBD" }, { namePrefix: "OBDII" }],
        optionalServices: [ELM327_SERVICE_UUID],
      });

      deviceRef.current = device;
      device.addEventListener("gattserverdisconnected", () => {
        setOBDStatus("disconnected");
      });

      const server = await device.gatt!.connect();
      const service = await server.getPrimaryService(ELM327_SERVICE_UUID);
      charWriteRef.current = await service.getCharacteristic(ELM327_CHAR_WRITE);
      const charNotify = await service.getCharacteristic(ELM327_CHAR_NOTIFY);

      await charNotify.startNotifications();
      charNotify.addEventListener("characteristicvaluechanged", handleNotification);

      for (const cmd of ELM_INIT_SEQUENCE) {
        await sendCommand(cmd);
        await new Promise(r => setTimeout(r, 200));
      }

      setOBDStatus("connected");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
      setOBDStatus("error");
    }
  }, [sendCommand, handleNotification]);

  const disconnect = useCallback(() => {
    deviceRef.current?.gatt?.disconnect();
    charWriteRef.current = null;
    setOBDStatus("disconnected");
    setOBDData({});
  }, []);

  const pollPIDs = useCallback(async () => {
    if (obdStatus !== "connected") return;
    const entries = Object.entries(PIDS);
    const updates: OBDData = {};
    for (const [key, pid] of entries) {
      try {
        const raw = await sendCommand(pid.pid);
        const lines = raw.split(/[\r\n]+/).filter(l => l && !l.startsWith("4"));
        const dataLine = raw.split(/[\r\n]+/).find(l => l.startsWith("4")) ?? "";
        const hex = dataLine.slice(4).trim(); // strip mode+pid echo
        const value = pid.parse(hex);
        if (value !== null) {
          updates[key.toLowerCase() as keyof OBDData] = value as any;
        }
      } catch {
        // individual PID failures are non-fatal
      }
    }
    setOBDData(prev => ({ ...prev, ...updates }));
  }, [obdStatus, sendCommand]);

  const scanDTCs = useCallback(async () => {
    if (obdStatus !== "connected") return;
    try {
      const raw = await sendCommand("03");
      const codes = parseDTCResponse(raw);
      setDtcCodes(codes.map(lookupDTC));
    } catch (e) {
      setError("Failed to read DTCs");
    }
  }, [obdStatus, sendCommand]);

  const clearDTCs = useCallback(async () => {
    if (obdStatus !== "connected") return;
    await sendCommand("04");
    setDtcCodes([]);
  }, [obdStatus, sendCommand]);

  return {
    obdStatus,
    obdData,
    dtcCodes,
    error,
    connect,
    disconnect,
    pollPIDs,
    scanDTCs,
    clearDTCs,
  };
}
