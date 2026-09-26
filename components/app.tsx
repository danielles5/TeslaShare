"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Home,
  LayoutDashboard,
  History,
  Settings,
  Car,
  Zap,
  PlusCircle,
  Scale,
  HandCoins,
  Pencil,
  Trash2,
  Database,
  LogOut,
  RefreshCw,
  ArrowUpRight,
  WifiOff,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { configured, db, mutate, snapshot } from "@/lib/db";
import { demoData } from "@/lib/demo";
import { nextBaseline, rebuildDerivedState } from "@/lib/engine";
import { date, km, money, name } from "@/lib/format";
import type { RangeEvent, Repayment, Snapshot } from "@/lib/types";
import { DemoBadge, Field, Metric, Sheet } from "./ui";
import { EventForm, type FormMode } from "./event-form";
import { Dashboard, SettlementDetail, SettlementRows } from "./dashboard";
type Tab = "Home" | "Dashboard" | "History" | "Settings";
type Modal =
  | { type: "event"; mode: FormMode; event?: RangeEvent }
  | { type: "repay" }
  | { type: "delete"; action: string; record?: RangeEvent | Repayment };
const EMPTY: Snapshot = {
  household: { id: "", name: "Danielle & Maya" },
  events: [],
  repayments: [],
};
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(configured);
  const [data, setData] = useState<Snapshot>(EMPTY);
  const [preview, setPreview] = useState(false);
  const [tab, setTab] = useState<Tab>("Home");
  const [modal, setModal] = useState<Modal | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const pendingRequest = useRef<{ signature: string; id: string } | null>(null);
  const fetchVersion = useRef(0);
  const [loading, setLoading] = useState(false);
  const derived = useMemo(
    () => rebuildDerivedState(data.events, data.repayments),
    [data],
  );
  const refresh = useCallback(async () => {
    const version = ++fetchVersion.current;
    setLoading(true);
    try {
      const result = await snapshot();
      if (version === fetchVersion.current) {
        setData(result);
        setError("");
      }
    } catch (e) {
      if (version === fetchVersion.current)
        setError(
          `Could not connect. ${message(e)} No new changes have been saved.`,
        );
    } finally {
      if (version === fetchVersion.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!configured) return;
    db()
      .auth.getSession()
      .then(({ data, error }) => {
        setUser(data.session?.user || null);
        setChecking(false);
        if (error) setError(error.message);
      });
    const { data: listener } = db().auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user || null);
        if (!session) {
          setData(EMPTY);
          setModal(null);
          setDetail(null);
        }
      },
    );
    return () => listener.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!user || preview) return;
    void refresh();
    const listener = () => {
      if (document.visibilityState === "visible" && !saving.current)
        void refresh();
    };
    window.addEventListener("focus", listener);
    document.addEventListener("visibilitychange", listener);
    const timer = setInterval(listener, 30000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", listener);
      document.removeEventListener("visibilitychange", listener);
    };
  }, [user, preview, refresh]);
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production")
      navigator.serviceWorker
        .register(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/sw.js`)
        .catch(() => {});
  }, []);
  const close = useCallback(() => {
    if (!saving.current) {
      setModal(null);
      setError("");
    }
  }, []);
  async function act(action: string, payload: unknown = {}) {
    if (preview) {
      setError(
        "This is a read-only preview. Connect Supabase and sign in to save real entries.",
      );
      return;
    }
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    ++fetchVersion.current;
    try {
      const signature = JSON.stringify({ action, payload });
      if (pendingRequest.current?.signature !== signature)
        pendingRequest.current = { signature, id: crypto.randomUUID() };
      const result = await mutate(action, {
        ...(payload as object),
        request_id: pendingRequest.current.id,
      });
      pendingRequest.current = null;
      ++fetchVersion.current;
      setData(result);
      setModal(null);
    } catch (e) {
      setError(
        `${message(e)} Your change was not confirmed. Retry after checking the connection.`,
      );
    } finally {
      saving.current = false;
      setBusy(false);
      setLoading(false);
    }
  }
  if (checking)
    return (
      <main className="app">
        <div className="loading">Opening your household…</div>
      </main>
    );
  if (!user && !preview)
    return (
      <Auth
        configured={configured}
        onPreview={() => {
          setPreview(true);
          setData({ ...EMPTY, ...demoData() });
        }}
      />
    );
  if (!preview && !data.household.id) {
    return (
      <main className="app">
        <div className="content">
          <h1>Tesla Share</h1>
          <p className="subtitle">Danielle & Maya</p>
          <section className="card">
            <h2>
              {error ? "Connection unavailable" : "Opening your household…"}
            </h2>
            {error ? (
              <>
                <p className="error" role="alert">
                  {error}
                </p>
                <button
                  className="button green"
                  disabled={loading}
                  onClick={() => void refresh()}
                >
                  {loading ? "Connecting…" : "Retry connection"}
                </button>
              </>
            ) : (
              <p className="hint">Loading your saved balance and entries.</p>
            )}
          </section>
          <button
            className="button secondary"
            style={{ marginTop: 18 }}
            onClick={async () => {
              const result = await db().auth.signOut();
              if (result.error) setError(result.error.message);
            }}
          >
            Sign out
          </button>
        </div>
      </main>
    );
  }
  const selected = derived.settlements.find((s) => s.id === detail);
  return (
    <div className="app">
      <main
        className={`content content-${selected ? "detail" : tab.toLowerCase()}`}
      >
        {preview && (
          <div className="preview-banner">
            Read-only preview{" "}
            <button
              onClick={() => {
                setPreview(false);
                setData(EMPTY);
                setModal(null);
              }}
            >
              Exit
            </button>
          </div>
        )}
        {error && !modal && (
          <div role="alert" className="error">
            <WifiOff size={18} />
            <span>{error}</span>
            <button
              onClick={() => void refresh()}
              aria-label="Retry connection"
            >
              <RefreshCw size={18} />
            </button>
          </div>
        )}
        {selected ? (
          <SettlementDetail
            settlement={selected}
            derived={derived}
            onBack={() => setDetail(null)}
          />
        ) : (
          <>
            {tab === "Home" && (
              <div className="home-layout">
                <header className="home-header">
                  <div>
                    <h1>Tesla Share</h1>
                    <p className="subtitle">Danielle & Maya</p>
                  </div>
                  {loading && (
                    <RefreshCw
                      className="spin"
                      size={16}
                      aria-label="Refreshing"
                    />
                  )}
                </header>
                <Balance balances={derived.balances} />
                <button
                  className="button secondary"
                  onClick={() => setModal({ type: "repay" })}
                >
                  <HandCoins size={19} />
                  Settle Debt
                </button>
                {derived.active ? (
                  <ActiveCard
                    event={derived.active}
                    onEnd={() =>
                      setModal({
                        type: "event",
                        mode: "end",
                        event: derived.active,
                      })
                    }
                  />
                ) : (
                  <div className="home-actions">
                    <button
                      className="button green big"
                      disabled={loading && !data.household.id}
                      onClick={() => setModal({ type: "event", mode: "drive" })}
                    >
                      <Car size={23} />
                      Start Drive
                    </button>
                    <button
                      className="button blue big"
                      disabled={loading && !data.household.id}
                      onClick={() =>
                        setModal({ type: "event", mode: "charge" })
                      }
                    >
                      <Zap size={23} />
                      Start Charge
                    </button>
                    <button
                      className="button secondary"
                      onClick={() =>
                        setModal({ type: "event", mode: "manual" })
                      }
                    >
                      <PlusCircle size={17} />
                      Add Forgotten Drive
                    </button>
                  </div>
                )}
                <section className="card period-card">
                  <div className="between">
                    <h3>This period</h3>
                    <small>
                      Last range{" "}
                      {derived.lastRange == null
                        ? "—"
                        : `${km(derived.lastRange)} km`}
                    </small>
                  </div>
                  {Object.values(derived.open.usage).some((n) => n > 0) ? (
                    Object.entries(derived.open.usage)
                      .filter(([, n]) => n > 0)
                      .map(([p, n]) => (
                        <div key={p} className="usage-row">
                          <Metric label={name(p)} value={`${km(n)} km`} />
                          <div className="usage-track">
                            <div
                              style={{
                                width: `${(n / Math.max(1, ...Object.values(derived.open.usage))) * 100}%`,
                                background:
                                  p === "danielle"
                                    ? "var(--danielle)"
                                    : p === "maya"
                                      ? "var(--maya)"
                                      : "#aaa",
                              }}
                            />
                          </div>
                        </div>
                      ))
                  ) : (
                    <p className="hint">No usage recorded yet.</p>
                  )}
                  {derived.open.cost > 0 && (
                    <p className="hint">
                      {money(derived.open.cost)} pending · settles at the next
                      full charge
                    </p>
                  )}
                </section>
              </div>
            )}
            {tab === "Dashboard" && (
              <Dashboard
                data={data}
                derived={derived}
                onSettlement={(s) => setDetail(s.id)}
              />
            )}
            {tab === "History" && (
              <HistoryView
                data={data}
                derived={derived}
                onEdit={(event) =>
                  setModal({ type: "event", mode: "edit", event })
                }
                onDelete={(record) =>
                  setModal({
                    type: "delete",
                    action: "delete_repayment",
                    record,
                  })
                }
                onSettlement={(id) => setDetail(id)}
              />
            )}
            {tab === "Settings" && (
              <>
                <h1>Settings</h1>
                <section className="card settings-card">
                  <h3>
                    <Database size={20} /> Demo data
                  </h3>
                  <p className="hint">
                    Explore realistic drives, charging, settlements and a
                    repayment across four months. All totals use the same
                    calculation engine as your real entries.
                  </p>
                  {data.events.some((e) => e.is_demo) && (
                    <div className="warning">
                      Demo data is currently loaded. You can remove all sample
                      data without affecting your real entries.
                    </div>
                  )}
                  <div className="button-row">
                    <button
                      className="button dark"
                      disabled={busy}
                      onClick={() => void act("load_demo", demoData())}
                    >
                      {busy ? "Loading…" : "Load Demo Data"}
                    </button>
                    <button
                      className="button danger"
                      disabled={busy || !data.events.some((e) => e.is_demo)}
                      onClick={() =>
                        setModal({ type: "delete", action: "delete_demo" })
                      }
                    >
                      <Trash2 size={17} />
                      Delete
                    </button>
                  </div>
                </section>
                <section className="card">
                  <h3>About</h3>
                  <p className="hint">
                    Tesla Share makes sharing a car a little simpler. Charging
                    costs follow the displayed battery range each person uses.
                    Shared rides split evenly, and parked range changes belong
                    to whoever has the car next.
                  </p>
                  <p className="hint">
                    Partial charges stay pending. A normal/full charge settles
                    the period, with actual payments and repayments keeping the
                    balance fair.
                  </p>
                  <div className="divider" />
                  <Metric label="Household" value="Danielle & Maya" />
                  <Metric label="Timezone" value="Asia/Jerusalem" />
                  <p className="hint">
                    Independent household app. Not affiliated with Tesla.
                  </p>
                </section>
                {!preview && (
                  <button
                    className="button secondary"
                    onClick={async () => {
                      const { error } = await db().auth.signOut();
                      if (error) setError(error.message);
                    }}
                  >
                    <LogOut size={18} />
                    Sign out
                  </button>
                )}
              </>
            )}
          </>
        )}
      </main>
      <nav className="bottom-nav" aria-label="Main navigation">
        {(
          [
            [Home, "Home"],
            [LayoutDashboard, "Dashboard"],
            [History, "History"],
            [Settings, "Settings"],
          ] as const
        ).map(([Icon, label]) => (
          <button
            key={label}
            className={tab === label ? "active" : ""}
            aria-current={tab === label ? "page" : undefined}
            onClick={() => {
              setTab(label);
              setDetail(null);
              window.scrollTo({ top: 0 });
            }}
          >
            <Icon size={21} strokeWidth={1.7} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {modal && (
        <Sheet
          title={
            modal.type === "repay"
              ? "Settle Debt"
              : modal.type === "delete"
                ? modal.action === "delete_demo"
                  ? "Delete demo data?"
                  : modal.action === "delete_repayment"
                    ? "Delete this repayment?"
                    : "Delete this entry?"
                : modal.mode === "edit"
                  ? modal.event?.kind === "charge"
                    ? "Edit Charge"
                    : "Edit Drive"
                  : modal.mode === "end"
                    ? modal.event?.kind === "charge"
                      ? "End Charge"
                      : "End Drive"
                    : modal.mode === "manual"
                      ? "Add Forgotten Drive"
                      : modal.mode === "missed_charge"
                        ? "Record Missed Charge"
                        : modal.mode === "charge"
                          ? "Start Charge"
                          : "Start Drive"
          }
          onClose={close}
        >
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {modal.type === "event" && (
            <EventForm
              key={`${modal.mode}-${modal.event?.id || ""}`}
              mode={modal.mode}
              event={modal.event}
              baseline={nextBaseline(data.events)}
              busy={busy}
              onSave={(e) => act("save_event", e)}
              onMissed={() =>
                setModal({ type: "event", mode: "missed_charge" })
              }
              onDelete={
                modal.event
                  ? () =>
                      setModal({
                        type: "delete",
                        action: "delete_event",
                        record: modal.event,
                      })
                  : undefined
              }
            />
          )}
          {modal.type === "repay" && (
            <RepaymentForm
              balances={derived.balances}
              busy={busy}
              onSave={(payload) => act("repay", payload)}
            />
          )}
          {modal.type === "delete" && (
            <div className="form-stack">
              <p className="hint">
                {modal.action === "delete_demo"
                  ? "Only this sample batch will be removed. Your real entries remain."
                  : "The running balance and related settlements will update accordingly. This cannot be undone."}
              </p>
              <div className="button-row">
                <button
                  className="button secondary"
                  onClick={close}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  className="button destructive"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      modal.action,
                      modal.record
                        ? {
                            id: modal.record.id,
                            ...("revision" in modal.record
                              ? { revision: modal.record.revision }
                              : {}),
                          }
                        : {},
                    )
                  }
                >
                  {busy ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}
function message(e: unknown) {
  return e instanceof Error ? e.message : "Something went wrong.";
}
function Balance({ balances }: { balances: Record<string, number> }) {
  const positions = Object.entries(balances).filter(
    ([, v]) => Math.abs(v) >= 0.005,
  );
  const onlySisters = positions.every(
    ([p]) => p === "danielle" || p === "maya",
  );
  const amount = Math.abs(balances.danielle || 0);
  return (
    <section className="balance-card">
      <div className="balance-label">
        <Scale size={14} />
        CURRENT BALANCE
      </div>
      {positions.length === 0 ? (
        <h2 className="settled">Settled up</h2>
      ) : onlySisters ? (
        <>
          <h2>{money(amount)}</h2>
          <p>
            {balances.danielle > 0
              ? "Maya owes Danielle"
              : "Danielle owes Maya"}
          </p>
        </>
      ) : (
        <>
          <h2>Household balances</h2>
          {positions.map(([p, n]) => (
            <Metric
              key={p}
              label={`${name(p)} ${n > 0 ? "receives" : "owes"}`}
              value={money(Math.abs(n))}
            />
          ))}
        </>
      )}
    </section>
  );
}
function ActiveCard({
  event,
  onEnd,
}: {
  event: RangeEvent;
  onEnd: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const seconds = Math.max(
    0,
    Math.floor((now - Date.parse(event.started_at)) / 1000),
  );
  const elapsed = `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  return (
    <section
      className={`active-card ${event.kind === "charge" ? "charging" : ""}`}
    >
      <p>
        {event.kind === "charge" ? <Zap size={17} /> : <Car size={17} />}{" "}
        {event.kind === "charge" ? "Charging" : "Drive"} in progress
      </p>
      <h3>
        {name(
          event.possession === "guest"
            ? `guest:${event.guest_name}`
            : event.possession,
        )}
      </h3>
      <div className="active-stats">
        <div>
          <small>ELAPSED</small>
          <strong>{elapsed}</strong>
        </div>
        <div>
          <small>START RANGE</small>
          <strong>{km(event.start_range!)} km</strong>
          <small>{date(event.started_at)}</small>
        </div>
      </div>
      <button className="button secondary" onClick={onEnd}>
        End {event.kind === "charge" ? "Charge" : "Drive"}
      </button>
    </section>
  );
}
function RepaymentForm({
  balances,
  busy,
  onSave,
}: {
  balances: Record<string, number>;
  busy: boolean;
  onSave: (p: unknown) => Promise<void>;
}) {
  const keys = Object.keys(balances);
  const debtor = keys.find((p) => balances[p] < -0.005) || "maya",
    creditor = keys.find((p) => balances[p] > 0.005) || "danielle";
  const [payer, setPayer] = useState(debtor),
    [recipient, setRecipient] = useState(creditor);
  const outstanding = Math.min(
    Math.max(0, -(balances[payer] || 0)),
    Math.max(0, balances[recipient] || 0),
  );
  const [amount, setAmount] = useState(""),
    [notes, setNotes] = useState("");
  return (
    <form
      className="form-stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy)
          void onSave({ payer, recipient, amount: Number(amount), notes });
      }}
    >
      <div className="soft-panel">
        <small>Outstanding</small>
        <h2>{money(outstanding)}</h2>
        <p>
          {outstanding
            ? `${name(payer)} owes ${name(recipient)}`
            : "No outstanding debt in this direction"}
        </p>
      </div>
      <Field
        label="Amount"
        value={amount}
        onChange={setAmount}
        suffix="₪"
        min="0.01"
        step="0.01"
        required
      />
      <button
        type="button"
        className="text-button"
        onClick={() => setAmount(outstanding.toFixed(2))}
      >
        Use full amount ({money(outstanding)})
      </button>
      <div className="field-grid">
        <label className="field">
          <span>From</span>
          <select value={payer} onChange={(e) => setPayer(e.target.value)}>
            {keys.map((p) => (
              <option key={p} value={p}>
                {name(p)}
              </option>
            ))}
          </select>
        </label>
        <ArrowUpRight size={22} />
        <label className="field">
          <span>To</span>
          <select
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          >
            {keys.map((p) => (
              <option key={p} value={p}>
                {name(p)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Field
        label="Note (optional)"
        type="text"
        value={notes}
        onChange={setNotes}
      />
      <button
        className="button green"
        disabled={busy || Number(amount) <= 0 || payer === recipient}
      >
        {busy ? "Saving…" : "Record Repayment"}
      </button>
    </form>
  );
}
function HistoryView({
  data,
  derived,
  onEdit,
  onDelete,
  onSettlement,
}: {
  data: Snapshot;
  derived: ReturnType<typeof rebuildDerivedState>;
  onEdit: (e: RangeEvent) => void;
  onDelete: (r: Repayment) => void;
  onSettlement: (id: string) => void;
}) {
  const [section, setSection] = useState("Drives");
  const events = [...data.events]
    .filter(
      (e) =>
        e.ended_at &&
        (section === "Drives" ? e.kind !== "charge" : e.kind === "charge"),
    )
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
  return (
    <>
      <h1>History</h1>
      <div className="history-tabs">
        {["Drives", "Charges", "Settlements", "Repayments"].map((t) => (
          <button
            className={section === t ? "selected" : ""}
            aria-pressed={section === t}
            key={t}
            onClick={() => setSection(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {section === "Settlements" ? (
        <SettlementRows
          settlements={derived.settlements}
          onSelect={(s) => onSettlement(s.id)}
        />
      ) : section === "Repayments" ? (
        <>
          {[...data.repayments].reverse().map((r) => (
            <section className="card history-card" key={r.id}>
              <div className="between">
                <strong>
                  {name(r.payer)} → {name(r.recipient)}
                </strong>
                <button
                  className="icon-button"
                  aria-label="Delete repayment"
                  onClick={() => onDelete(r)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
              <h2>{money(r.amount)}</h2>
              <small>
                {date(r.occurred_at)} {r.is_demo && <DemoBadge />}
              </small>
              {r.notes && <p className="hint">{r.notes}</p>}
            </section>
          ))}
          {!data.repayments.length && (
            <Empty text="Recorded repayments will appear here." />
          )}
        </>
      ) : (
        <>
          {events.map((e) => (
            <section className="card history-card" key={e.id}>
              <div className="between">
                <div>
                  <strong>
                    {e.kind === "charge"
                      ? e.charge_type === "normal_full"
                        ? "Normal / Full"
                        : "Partial / Emergency"
                      : name(
                          e.possession === "guest"
                            ? `guest:${e.guest_name}`
                            : e.possession,
                        )}
                  </strong>{" "}
                  {e.is_demo && <DemoBadge />}
                </div>
                <button
                  className="icon-button"
                  aria-label={`Edit ${e.kind === "charge" ? "charge" : "drive"}`}
                  onClick={() => onEdit(e)}
                >
                  <Pencil size={17} />
                </button>
              </div>
              <small>{date(e.started_at)}</small>
              <div className="history-range">
                {e.kind === "manual"
                  ? `${km(e.distance!)} km`
                  : `${km(e.start_range!)} → ${km(e.end_range!)} km`}
              </div>
              {e.kind === "charge" ? (
                <>
                  <strong>{money(e.cost!)}</strong>
                  <p className="hint">
                    Paid by{" "}
                    {name(
                      e.payer === "guest"
                        ? `guest:${e.payer_guest_name}`
                        : e.payer!,
                    )}{" "}
                    · Possession: {name(e.possession)}
                    {e.kwh != null ? ` · ${km(e.kwh)} kWh` : ""}
                    {e.rate != null ? ` · ₪${e.rate.toFixed(3)}/kWh` : ""}
                  </p>
                </>
              ) : (
                <>
                  <strong>
                    Used:{" "}
                    {km(
                      e.kind === "manual"
                        ? e.distance!
                        : e.start_range! - e.end_range!,
                    )}{" "}
                    km
                  </strong>
                  <p className="hint">
                    {e.duration_minutes != null
                      ? `${Math.round(e.duration_minutes)} min · `
                      : ""}
                    {e.kind === "manual" ? "Manual Estimate" : "Range Tracking"}
                    {derived.idle[e.id]
                      ? ` · idle ${derived.idle[e.id] > 0 ? "+" : ""}${km(derived.idle[e.id])} km`
                      : ""}
                  </p>
                </>
              )}
              {e.notes && <p className="hint">{e.notes}</p>}
            </section>
          ))}
          {!events.length && (
            <Empty text={`Your ${section.toLowerCase()} will appear here.`} />
          )}
        </>
      )}
    </>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="card empty">{text}</div>;
}
function Auth({
  configured,
  onPreview,
}: {
  configured: boolean;
  onPreview: () => void;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="app auth">
      <div className="auth-mark">
        <Car size={30} />
      </div>
      <h1>Tesla Share</h1>
      <p className="subtitle">Danielle & Maya</p>
      <section className="card">
        <h2>{configured ? "Welcome home" : "Your shared car, simplified."}</h2>
        <p className="hint">
          {configured
            ? "Sign in with your private household account."
            : "Track your drives. Split charging fairly. Keep the little things between sisters simple."}
        </p>
        {configured ? (
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              const { error } = await db().auth.signInWithPassword({
                email,
                password,
              });
              if (error) setError(error.message);
              setBusy(false);
            }}
          >
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && (
              <div role="alert" className="error">
                {error}
              </div>
            )}
            <button className="button green" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        ) : (
          <div className="warning">
            Connect your Supabase project using <code>.env.local</code> to
            enable sign-in and saved entries. Setup steps are in the README.
          </div>
        )}
      </section>
      <button className="button secondary" onClick={onPreview}>
        Explore read-only demo <ArrowUpRight size={18} />
      </button>
      <p className="auth-note">Private by design. Just the two of you.</p>
    </main>
  );
}
