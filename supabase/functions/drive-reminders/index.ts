import { createClient } from "@supabase/supabase-js";
// @deno-types="@types/web-push"
import webpush from "web-push";
import {
  deliverClaim,
  thresholdMinutes,
  validEndpoint,
  validSubscription,
  type Device,
} from "./core.ts";

const env = (key: string) => {
  const v = Deno.env.get(key);
  if (!v) throw new Error(`Missing ${key}`);
  return v;
};
const appUrl = () => {
  const u = new URL(env("DRIVE_REMINDER_APP_URL"));
  if (
    u.protocol !== "https:" ||
    !u.pathname.endsWith("/") ||
    u.search ||
    u.hash
  )
    throw new Error("Invalid app URL");
  return u;
};
async function secretMatches(actual: string | null, expected: string) {
  if (!actual || expected.length < 32) return false;
  const digest = async (s: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    );
  const [a, b] = await Promise.all([digest(actual), digest(expected)]);
  return a.reduce((diff, byte, i) => diff | (byte ^ b[i]), 0) === 0;
}
function keys() {
  const details = {
    subject: env("VAPID_SUBJECT"),
    publicKey: env("VAPID_PUBLIC_KEY"),
    privateKey: env("VAPID_PRIVATE_KEY"),
  };
  webpush.setVapidDetails(
    details.subject,
    details.publicKey,
    details.privateKey,
  );
  return details;
}
async function send(device: Device, driveId?: string) {
  if (!validEndpoint(device.endpoint))
    throw new Error("Unsupported push endpoint");
  const details = webpush.generateRequestDetails(
    {
      endpoint: device.endpoint,
      keys: { p256dh: device.p256dh, auth: device.auth_key },
    },
    JSON.stringify({
      title: "TeslaTrack",
      body: driveId
        ? "Did you finish your drive? 🚗"
        : "Drive reminders are working on this device. 🚗",
      driveId: driveId || null,
      tag: driveId
        ? `teslatrack-drive-${driveId}`
        : `teslatrack-test-${crypto.randomUUID()}`,
    }),
    {
      vapidDetails: keys(),
      TTL: 300,
      urgency: "high",
      contentEncoding: "aes128gcm",
    },
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(device.endpoint, {
      method: "POST",
      headers: details.headers as Record<string, string>,
      body: details.body ? new Uint8Array(details.body) : undefined,
      signal: controller.signal,
      redirect: "error",
    });
    await response.body?.cancel();
    return response.status;
  } finally {
    clearTimeout(timer);
  }
}
Deno.serve(async (req) => {
  let headers: Record<string, string> = {
    "Content-Type": "application/json",
    Vary: "Origin",
  };
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers });
  try {
    const origin = appUrl().origin;
    if (req.headers.get("Origin") && req.headers.get("Origin") !== origin)
      return reply({ error: "Origin not allowed" }, 403);
    headers = {
      ...headers,
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers":
        "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    };
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (req.method !== "POST")
      return reply({ error: "Method not allowed" }, 405);
    const body = await req.json();
    const admin = createClient(
      env("SUPABASE_URL"),
      env("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const expire = async (device: Device) => {
      const { error } = await admin
        .from("drive_push_devices")
        .update({ enabled: false, updated_at: new Date().toISOString() })
        .eq("id", device.id)
        .eq("endpoint", device.endpoint);
      if (error) throw error;
    };
    if (body.action === "tick") {
      if (
        !(await secretMatches(
          req.headers.get("x-drive-reminder-secret"),
          env("DRIVE_REMINDER_CRON_SECRET"),
        ))
      )
        return reply({ error: "Not authorized" }, 401);
      keys(); // Fail before any claims when server configuration is missing.
      const threshold = thresholdMinutes(
        Deno.env.get("DRIVE_REMINDER_THRESHOLD_MINUTES"),
      );
      const { data: claims, error } = await admin.rpc("claim_drive_reminders", {
        threshold_minutes: threshold,
      });
      if (error) throw error;
      const outcomes = [];
      for (let i = 0; i < (claims || []).length; i += 4)
        outcomes.push(
          ...(await Promise.all(
            claims
              .slice(i, i + 4)
              .map(
                (claim: { id: string; drive_id: string; device_id: string }) =>
                  deliverClaim(claim, {
                    recheck: async (id) => {
                      const { data, error } = await admin.rpc(
                        "prepare_drive_reminder",
                        { delivery_id: id, threshold_minutes: threshold },
                      );
                      if (error) throw error;
                      return data?.[0] || null;
                    },
                    send,
                    expire,
                    finish: async (id, outcome) => {
                      const { error } = await admin
                        .from("drive_reminder_deliveries")
                        .update({
                          ...outcome,
                          finished_at: new Date().toISOString(),
                        })
                        .eq("id", id)
                        .eq("status", "claimed");
                      if (error) throw error;
                    },
                  }),
              ),
          )),
        );
      return reply({
        attempted: outcomes.length,
        accepted: outcomes.filter((o) => o.status === "accepted").length,
      });
    }
    const token = req.headers.get("Authorization")?.replace(/^Bearer /i, "");
    if (!token) return reply({ error: "Sign in to manage this device" }, 401);
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user)
      return reply({ error: "Sign in to manage this device" }, 401);
    const user = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    if (body.action === "config") {
      const k = keys();
      const { data, error } = await admin
        .from("drive_reminder_settings")
        .select("enabled,activated_at")
        .eq("singleton", true)
        .single();
      if (error) throw error;
      return reply({
        publicKey: k.publicKey,
        active: Boolean(data.enabled && data.activated_at),
      });
    }
    if (!["status", "register", "disable", "test"].includes(body.action))
      return reply({ error: "Invalid action" }, 400);
    if (!body.subscription || !validEndpoint(body.subscription.endpoint))
      return reply({ error: "Current device subscription required" }, 400);
    if (
      body.action === "register" &&
      (!validSubscription(body.subscription) ||
        !["danielle", "maya"].includes(body.participant) ||
        !/^[0-9a-f-]{36}$/i.test(body.deviceId || ""))
    )
      return reply({ error: "Invalid device registration" }, 400);
    if (body.action === "test") keys();
    const { data, error } = await user.rpc("drive_push_device", {
      action: body.action,
      device_id: body.deviceId || null,
      subscription: body.subscription,
      person: body.participant || null,
    });
    if (error)
      return reply(
        {
          error:
            body.action === "test"
              ? "Enable this device first, or wait one minute before another test."
              : "Could not update this device. Please try again.",
        },
        400,
      );
    if (body.action === "test") {
      try {
        const { data: device, error: deviceError } = await admin
          .from("drive_push_devices")
          .select("id,endpoint,p256dh,auth_key")
          .eq("id", data.id)
          .eq("endpoint", body.subscription.endpoint)
          .eq("enabled", true)
          .single();
        if (deviceError || !device) throw new Error("Device unavailable");
        const status = await send(device);
        if (status === 404 || status === 410) await expire(device);
        return reply(
          { accepted: status >= 200 && status < 300 },
          status >= 200 && status < 300 ? 200 : 502,
        );
      } catch {
        return reply(
          {
            error:
              "Push delivery could not be confirmed. Wait one minute before testing again.",
          },
          502,
        );
      }
    }
    return reply({ device: data });
  } catch {
    return reply(
      {
        error: "Drive reminders are unavailable. Drive tracking is unaffected.",
      },
      503,
    );
  }
});
