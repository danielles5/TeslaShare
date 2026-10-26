import { db } from "./db";
export type PushDevice = {
  id: string;
  participant: "danielle" | "maya";
  enabled: boolean;
  expiration_time: string | null;
};
export type ReminderConfig = { publicKey: string; active: boolean };
export async function reminderRequest<T>(
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await db().functions.invoke("drive-reminders", {
    body,
  });
  if (error || data?.error)
    throw new Error(
      body.action === "test"
        ? "Test could not be confirmed. Ensure this device is enabled, then wait one minute before trying again."
        : "Drive reminders are unavailable. Your drive tracking is unaffected. Please try again later.",
    );
  return data as T;
}
const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
export function reminderSupport() {
  const ios =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const installed =
    matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  if (ios && !installed)
    return "On iPhone, open TeslaTrack from its Home Screen icon. To install it, open this page in Safari, tap Share, then Add to Home Screen.";
  if (
    !window.isSecureContext ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  )
    return "This browser does not support Web Push. On iPhone, use the installed Home Screen app on iOS 16.4 or later.";
  return null;
}
export async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration(
    `${base}/`,
  );
  return registration ? await registration.pushManager.getSubscription() : null;
}
export function deviceIdentity(existing?: string) {
  const key = `teslatrack:push-device:${base || "/"}`;
  const id = existing || localStorage.getItem(key) || crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}
export async function subscribe(publicKey: string) {
  await navigator.serviceWorker.register(`${base}/sw.js`, {
    scope: `${base}/`,
  });
  const registration = await navigator.serviceWorker.ready;
  if (new URL(registration.scope).pathname !== `${base}/`)
    throw new Error("Please reload the app before enabling reminders.");
  const existing = await registration.pushManager.getSubscription();
  if (
    existing &&
    (!existing.expirationTime || existing.expirationTime > Date.now())
  )
    return existing;
  if (existing) await existing.unsubscribe();
  const decoded = atob(publicKey.replace(/-/g, "+").replace(/_/g, "/"));
  const key = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) key[i] = decoded.charCodeAt(i);
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
}
