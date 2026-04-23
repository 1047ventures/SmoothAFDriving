import { useState, useRef, useCallback, useEffect } from "react";
import { createScoreState, processSample, ScoreState, MotionSample } from "@/lib/smoothScore";

export interface GeoPoint {
  lat: number;
  lng: number;
  speed: number;
  score: number;
  ts: number;
}

export interface DriveSession {
  id: string;
  startedAt: number;
  endedAt?: number;
  route: GeoPoint[];
  scoreState: ScoreState;
  distanceKm: number;
}

export type DriveStatus = "idle" | "active" | "paused" | "ended";

export function useDriveSession() {
  const [status, setStatus] = useState<DriveStatus>("idle");
  const [session, setSession] = useState<DriveSession | null>(null);
  const [currentScore, setCurrentScore] = useState(100);

  const scoreStateRef = useRef<ScoreState>(createScoreState());
  const watchIdRef = useRef<number | null>(null);
  const motionHandlerRef = useRef<((e: DeviceMotionEvent) => void) | null>(null);
  const sessionRef = useRef<DriveSession | null>(null);

  const start = useCallback(async () => {
    const id = crypto.randomUUID();
    const newSession: DriveSession = {
      id,
      startedAt: Date.now(),
      route: [],
      scoreState: createScoreState(),
      distanceKm: 0,
    };
    scoreStateRef.current = createScoreState();
    sessionRef.current = newSession;
    setSession(newSession);
    setStatus("active");
    setCurrentScore(100);

    // GPS tracking
    if ("geolocation" in navigator) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const point: GeoPoint = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            speed: (pos.coords.speed ?? 0) * 3.6, // m/s → km/h
            score: scoreStateRef.current.score,
            ts: Date.now(),
          };
          sessionRef.current = sessionRef.current
            ? {
                ...sessionRef.current,
                route: [...sessionRef.current.route, point],
                distanceKm: calcDistance(sessionRef.current.route, point),
              }
            : null;
          setSession(s => s ? { ...s, route: [...s.route, point] } : s);
        },
        null,
        { enableHighAccuracy: true, maximumAge: 1000 }
      );
    }

    // High-pass filter state for gravity removal fallback
    let gravX = 0, gravY = 0, gravZ = 0;
    const HP_ALPHA = 0.9; // ~0.9s time constant at ~10Hz GPS cadence

    // Motion / accelerometer
    const handler = (e: DeviceMotionEvent) => {
      let ax: number, ay: number, az: number;

      // Prefer acceleration (gravity-free). Fall back to high-pass filtered
      // accelerationIncludingGravity if the gravity-subtracted value is unavailable.
      const clean = e.acceleration;
      if (clean && clean.x != null) {
        ax = (clean.x ?? 0) / 9.81;
        ay = (clean.y ?? 0) / 9.81;
        az = (clean.z ?? 0) / 9.81;
      } else {
        const raw = e.accelerationIncludingGravity;
        if (!raw) return;
        const rx = raw.x ?? 0, ry = raw.y ?? 0, rz = raw.z ?? 0;
        gravX = HP_ALPHA * gravX + (1 - HP_ALPHA) * rx;
        gravY = HP_ALPHA * gravY + (1 - HP_ALPHA) * ry;
        gravZ = HP_ALPHA * gravZ + (1 - HP_ALPHA) * rz;
        ax = (rx - gravX) / 9.81;
        ay = (ry - gravY) / 9.81;
        az = (rz - gravZ) / 9.81;
      }

      const sample: MotionSample = { timestamp: Date.now(), ax, ay, az, speed: 0 };
      scoreStateRef.current = processSample(scoreStateRef.current, sample);
      setCurrentScore(scoreStateRef.current.score);
      setSession(s => s ? { ...s, scoreState: scoreStateRef.current } : s);
    };

    motionHandlerRef.current = handler;
    window.addEventListener("devicemotion", handler);
  }, []);

  const stop = useCallback((): DriveSession | null => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (motionHandlerRef.current) {
      window.removeEventListener("devicemotion", motionHandlerRef.current);
      motionHandlerRef.current = null;
    }
    const ended = sessionRef.current
      ? { ...sessionRef.current, endedAt: Date.now() }
      : null;
    setSession(ended);
    setStatus("ended");
    return ended;
  }, []);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      if (motionHandlerRef.current) window.removeEventListener("devicemotion", motionHandlerRef.current);
    };
  }, []);

  return { status, session, currentScore, start, stop };
}

function calcDistance(route: GeoPoint[], next: GeoPoint): number {
  if (route.length === 0) return 0;
  const prev = route[route.length - 1];
  const R = 6371;
  const dLat = deg2rad(next.lat - prev.lat);
  const dLng = deg2rad(next.lng - prev.lng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(prev.lat)) * Math.cos(deg2rad(next.lat)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return Math.sqrt(a / (1 - a)) * 2 * R / 1000;
}

function deg2rad(deg: number) { return deg * (Math.PI / 180); }
