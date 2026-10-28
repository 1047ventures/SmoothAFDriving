import { Capacitor } from '@capacitor/core';

/** Open an outside page: the in-app browser sheet on iOS, a new tab on the web. */
export async function openUrl(url){
  if (Capacitor.isNativePlatform()){
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } else {
    window.open(url, '_blank', 'noopener');
  }
}
