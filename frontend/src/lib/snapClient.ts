const SNAP_SCRIPT_URL = "https://app.sandbox.midtrans.com/snap/snap.js";
const MIDTRANS_CLIENT_KEY = "Mid-client-pLqckO1qyvfxRaD4";

export interface SnapCallbacks {
  onSuccess?: (result: any) => void;
  onPending?: (result: any) => void;
  onError?: (result: any) => void;
  onClose?: () => void;
}

/**
 * Loads or resets Midtrans Snap.js dynamically in SPA
 * to prevent stale iframe/postMessage null reference errors on consecutive transactions.
 */
export async function payWithSnap(snapToken: string, callbacks: SnapCallbacks): Promise<void> {
  if (typeof window === "undefined" || !snapToken) return;

  const loadFreshSnap = (): Promise<any> => {
    return new Promise((resolve) => {
      // Remove old script and iframe to ensure clean singleton state
      const oldScript = document.getElementById("midtrans-snap-script");
      if (oldScript) oldScript.remove();

      const oldIframe = document.getElementById("snap-midtrans");
      if (oldIframe) oldIframe.remove();

      const oldContainers = document.querySelectorAll(".snap-container, #snap-container");
      oldContainers.forEach((el) => el.remove());

      delete (window as any).snap;

      const script = document.createElement("script");
      script.id = "midtrans-snap-script";
      script.src = SNAP_SCRIPT_URL;
      script.setAttribute("data-client-key", MIDTRANS_CLIENT_KEY);
      script.async = true;
      script.onload = () => {
        resolve((window as any).snap);
      };
      script.onerror = () => {
        resolve(null);
      };
      document.body.appendChild(script);
    });
  };

  try {
    // If snap is already available and iframe is healthy, try direct pay
    const existingIframe = document.getElementById("snap-midtrans");
    if ((window as any).snap && existingIframe && typeof (window as any).snap.pay === "function") {
      (window as any).snap.pay(snapToken, callbacks);
      return;
    }
  } catch {
    // Fallback to fresh reload if direct pay failed
  }

  // Load fresh instance
  const snap = await loadFreshSnap();
  if (snap && typeof snap.pay === "function") {
    snap.pay(snapToken, callbacks);
  }
}
