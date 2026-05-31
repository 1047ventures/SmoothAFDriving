import { state } from '../state.js';

export async function requestWakeLock(){
  if (!('wakeLock' in navigator)) return;
  try {
    state.wakeLock = await navigator.wakeLock.request('screen');
  } catch {}
}

export function releaseWakeLock(){
  if (state.wakeLock){
    state.wakeLock.release().catch(() => {});
    state.wakeLock = null;
  }
}
