/**
 * Helper to safely request Notification permission from a user gesture.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return 'unsupported';
  }
}

/**
 * Helper to safely send a web or service worker notification without throwing errors.
 * Supports Android Chrome (ServiceWorkerRegistration.showNotification) and standard Notification API.
 */
export async function sendNotification(title: string, options?: NotificationOptions): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration('/app/').catch(() => null)
        || await navigator.serviceWorker.getRegistration().catch(() => null);
      if (reg && 'showNotification' in reg) {
        await reg.showNotification(title, options);
        return;
      }
    }
  } catch {
    // Fall back to standard Notification constructor
  }

  try {
    new Notification(title, options);
  } catch {
    // Android Chrome or restricted environments throw on 'new Notification'
  }
}
