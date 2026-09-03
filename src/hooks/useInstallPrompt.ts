import { useEffect, useState } from 'react';

// iOS Safari (and every other iOS browser, which are all required to use WebKit)
// never fires `beforeinstallprompt` — Apple has never implemented that API, on any
// iOS version, on purpose. The only way to install a PWA on iOS is the manual
// Share sheet -> "Add to Home Screen" flow, which we detect for here so the UI
// can show instructions instead of waiting forever for an event that won't come.
function detectIOS(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIPhoneOrIPad = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ reports a desktop Mac user agent string, so the classic check misses
  // it. Distinguish it from a real Mac by checking for a multi-touch screen.
  const isIPadOS13Plus = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return isIPhoneOrIPad || isIPadOS13Plus;
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
    // Safari-only, non-standard, but the most reliable signal on iOS
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(detectStandalone());
  const [isIOS] = useState(detectIOS);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  };

  // On iOS there's no deferred prompt to wait for — if it's an iOS browser and the
  // app isn't already installed, we can always offer the (manual) install flow.
  const canInstall = (!!deferredPrompt || isIOS) && !installed;
  // Tells the caller whether tapping "install" should trigger the native prompt
  // (deferredPrompt) or show manual Add to Home Screen instructions instead.
  const needsManualInstall = isIOS && !deferredPrompt;

  return { canInstall, promptInstall, installed, isIOS, needsManualInstall };
}
