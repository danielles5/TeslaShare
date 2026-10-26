export const DEFAULT_THRESHOLD_MINUTES = 45;
export function thresholdMinutes(value?: string): number {
  const n = value === undefined ? DEFAULT_THRESHOLD_MINUTES : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 1440)
    throw new Error("Invalid DRIVE_REMINDER_THRESHOLD_MINUTES");
  return n;
}
export function validEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4096) return false;
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      !u.hash &&
      (u.hostname === "web.push.apple.com" ||
        u.hostname.endsWith(".push.apple.com") ||
        u.hostname === "fcm.googleapis.com" ||
        u.hostname === "updates.push.services.mozilla.com")
    );
  } catch {
    return false;
  }
}
export function validSubscription(
  s: unknown,
): s is {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
} {
  if (!s || typeof s !== "object") return false;
  const x = s as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
    expirationTime?: unknown;
  };
  return (
    validEndpoint(x.endpoint) &&
    typeof x.keys?.p256dh === "string" &&
    /^[A-Za-z0-9_-]{87}$/.test(x.keys.p256dh) &&
    typeof x.keys?.auth === "string" &&
    /^[A-Za-z0-9_-]{22}$/.test(x.keys.auth) &&
    (x.expirationTime == null ||
      (typeof x.expirationTime === "number" &&
        Number.isFinite(x.expirationTime) &&
        x.expirationTime > Date.now()))
  );
}
export type Delivery = { id: string; drive_id: string; device_id: string };
export type Device = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
};
export type Outcome = {
  status: "accepted" | "failed" | "uncertain" | "expired" | "skipped";
  http_status: number | null;
};
// Claim is durable before sending. Every claim is attempted at most once. Neither
// timeout nor a failed status update can release it and accidentally resend.
export async function deliverClaim(
  delivery: Delivery,
  io: {
    recheck: (id: string) => Promise<Device | null>;
    send: (device: Device, driveId: string) => Promise<number>;
    finish: (id: string, outcome: Outcome) => Promise<void>;
    expire: (device: Device) => Promise<void>;
  },
) {
  let outcome: Outcome = { status: "uncertain", http_status: null };
  try {
    const device = await io.recheck(delivery.id);
    if (!device) outcome = { status: "skipped", http_status: null };
    else {
      const code = await io.send(device, delivery.drive_id);
      outcome = {
        status:
          code >= 200 && code < 300
            ? "accepted"
            : code === 404 || code === 410
              ? "expired"
              : "failed",
        http_status: code,
      };
      if (outcome.status === "expired") await io.expire(device);
    }
  } catch {
    /* The request may have been accepted. Never retry this claim. */
  }
  try {
    await io.finish(delivery.id, outcome);
  } catch {
    /* Durable claim still prevents another send. */
  }
  return outcome;
}
