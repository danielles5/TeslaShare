"use client";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import {
  currentSubscription,
  deviceIdentity,
  reminderRequest,
  reminderSupport,
  subscribe,
  type PushDevice,
  type ReminderConfig,
} from "@/lib/drive-reminders";
export function DriveReminders({ preview }: { preview: boolean }) {
  const [config, setConfig] = useState<ReminderConfig | null>(null);
  const [device, setDevice] = useState<PushDevice | null>(null);
  const [participant, setParticipant] = useState<"danielle" | "maya" | null>(
    null,
  );
  const [permission, setPermission] = useState<string>("Not checked");
  const [help, setHelp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let cancelled = false;
    const unsupported = preview
      ? "Sign in to configure reminders on this device."
      : reminderSupport();
    setHelp(unsupported);
    setPermission(
      typeof Notification === "undefined"
        ? "Unsupported"
        : Notification.permission,
    );
    if (!unsupported)
      void (async () => {
        try {
          const cfg = await reminderRequest<ReminderConfig>({
            action: "config",
          });
          const sub = await currentSubscription();
          const current = sub
            ? await reminderRequest<{ device: PushDevice | null }>({
                action: "status",
                subscription: sub.toJSON(),
              })
            : { device: null };
          if (!cancelled) {
            setConfig(cfg);
            setDevice(current.device);
            setParticipant(current.device?.participant || null);
          }
        } catch (e) {
          if (!cancelled)
            setError(
              e instanceof Error ? e.message : "Reminders are unavailable.",
            );
        }
      })();
    return () => {
      cancelled = true;
    };
  }, [preview]);
  async function register(person: "danielle" | "maya", sub: PushSubscription) {
    const result = await reminderRequest<{ device: PushDevice }>({
      action: "register",
      deviceId: deviceIdentity(device?.id),
      participant: person,
      subscription: sub.toJSON(),
    });
    setDevice(result.device);
    setParticipant(result.device.participant);
    deviceIdentity(result.device.id);
  }
  async function enable() {
    if (!participant || !config || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      // Permission prompt stays in this direct user-gesture handler, before network work.
      const allowed = await Notification.requestPermission();
      setPermission(allowed);
      if (allowed !== "granted")
        throw new Error(
          "Notifications were not allowed. You can change this app's notification permission in device settings.",
        );
      deviceIdentity(device?.id);
      await register(participant, await subscribe(config.publicKey));
      setNotice("Notifications enabled on this device.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not enable notifications.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function changePerson(person: "danielle" | "maya") {
    if (!device?.enabled) {
      setParticipant(person);
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const sub = await currentSubscription();
      if (!sub)
        throw new Error(
          "This browser subscription is missing. Enable notifications again.",
        );
      await register(person, sub);
      setNotice("This device's participant was updated.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not update this device.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function act(action: "test" | "disable") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const sub = await currentSubscription();
      if (!sub)
        throw new Error(
          "This browser subscription is missing. Enable notifications again.",
        );
      const result = await reminderRequest<{ accepted?: boolean }>({
        action,
        subscription: sub.toJSON(),
      });
      if (action === "disable") {
        setDevice(null);
        await sub.unsubscribe();
        setNotice("Notifications disabled on this device only.");
      } else
        setNotice(
          result.accepted
            ? "Test accepted by the push service. Check this device's notifications."
            : "Test was not accepted. Try enabling notifications again.",
        );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not update this device.",
      );
    } finally {
      setBusy(false);
    }
  }
  const enabled = Boolean(
    device?.enabled &&
    permission === "granted" &&
    (!device.expiration_time ||
      Date.parse(device.expiration_time) > Date.now()),
  );
  return (
    <section className="card settings-card" style={{ gridColumn: "1 / -1" }}>
      <h3>
        <Bell size={20} /> Drive Reminders
      </h3>
      <div className="field">
        <span>This Device Belongs To</span>
        <div className="people">
          {(["danielle", "maya"] as const).map((p) => (
            <button
              key={p}
              className={participant === p ? "selected" : ""}
              aria-pressed={participant === p}
              disabled={busy || Boolean(help)}
              onClick={() => void changePerson(p)}
            >
              {p === "danielle" ? "Danielle" : "Maya"}
            </button>
          ))}
        </div>
      </div>
      <p className="hint">
        Permission: {permission}. This device:{" "}
        {enabled ? "Enabled" : "Not enabled"}.
      </p>
      {help && <p className="hint">{help}</p>}
      {config && !config.active && (
        <p className="hint">
          The server schedule has not been activated yet. You can register this
          device and send a test.
        </p>
      )}
      <div className="button-row">
        <button
          className="button dark"
          disabled={busy || Boolean(help) || !config || !participant || enabled}
          onClick={() => void enable()}
        >
          {busy ? "Please wait…" : "Enable Notifications"}
        </button>
      </div>
      <div className="button-row">
        <button
          className="button secondary"
          disabled={busy || !enabled}
          onClick={() => void act("test")}
        >
          Send Test Notification
        </button>
      </div>
      <div className="button-row">
        <button
          className="button secondary"
          disabled={busy || !device?.enabled}
          onClick={() => void act("disable")}
        >
          Disable Notifications on This Device
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="hint" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
