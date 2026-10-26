// Kept apart from the worker's own code so the worker bundle shares no chunk with the page.
/** The installed browser app only: the desktop window and the development server have no worker. */
export function registerServiceWorker(env: { production: boolean; desktop: boolean } = { production: import.meta.env.PROD, desktop: !!window.desktop }) {
  if (!env.production || env.desktop || !("serviceWorker" in navigator) || !/^https?:$/.test(window.location.protocol)) return false
  void navigator.serviceWorker.register("/sw.js").catch(error => console.warn("Offline support is unavailable:", error))
  return true
}
