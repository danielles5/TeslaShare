"use client";
import { useState } from "react";
import type { RangeEvent, Possession } from "@/lib/types";
import { chargeFields, splitUsage } from "@/lib/engine";
import { date, km, name, money } from "@/lib/format";
import { Field, People, Metric } from "./ui";
export type FormMode =
  "drive" | "charge" | "manual" | "missed_charge" | "end" | "edit";
export function EventForm({
  mode,
  event,
  baseline,
  onSave,
  onDelete,
  onMissed,
  busy,
}: {
  mode: FormMode;
  event?: RangeEvent;
  baseline: number | null;
  onSave: (e: Partial<RangeEvent>) => Promise<void>;
  onDelete?: () => void;
  onMissed: () => void;
  busy: boolean;
}) {
  const editing = mode === "edit",
    ending = mode === "end",
    manual = mode === "manual" || event?.kind === "manual",
    charging =
      mode === "charge" || mode === "missed_charge" || event?.kind === "charge";
  const complete = ending || editing || manual || mode === "missed_charge";
  const [possession, setPossession] = useState<Possession>(
    event?.possession || "danielle",
  );
  const [guest, setGuest] = useState(event?.guest_name || "");
  const [start, setStart] = useState(event?.start_range?.toString() || "");
  const [end, setEnd] = useState(event?.end_range?.toString() || "");
  const [distance, setDistance] = useState(event?.distance?.toString() || "");
  const [duration, setDuration] = useState(
    event?.duration_minutes?.toString() || "",
  );
  const [day, setDay] = useState(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jerusalem",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(event?.started_at || Date.now())),
  );
  const [cost, setCost] = useState(event?.cost?.toString() || "");
  const [kwh, setKwh] = useState(event?.kwh?.toString() || "");
  const [rate, setRate] = useState(event?.rate?.toString() || "");
  const [payer, setPayer] = useState<Possession>(event?.payer || "danielle");
  const [payerGuest, setPayerGuest] = useState(event?.payer_guest_name || "");
  const [chargeType, setChargeType] = useState(
    event?.charge_type || "normal_full",
  );
  const [notes, setNotes] = useState(event?.notes || "");
  const [confirmed, setConfirmed] = useState(false);
  const [acceptedCost, setAcceptedCost] = useState(false);
  const fields = chargeFields(cost, kwh, rate);
  const idle =
    baseline == null || start === "" ? null : baseline - Number(start);
  const unusual =
    !editing && !ending && !manual && idle != null && Math.abs(idle) > 80;
  const used = start !== "" && end !== "" ? Number(start) - Number(end) : null;
  const unusualEnd =
    complete &&
    !manual &&
    used != null &&
    (charging ? used > 20 : used < -20 || used > 350);
  const nonnegative = (value: string) =>
    value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const valid =
    (!manual
      ? nonnegative(start) && (!complete || nonnegative(end))
      : nonnegative(distance) &&
        day !== "" &&
        day <= today &&
        (duration === "" || nonnegative(duration))) &&
    (possession !== "guest" || guest.trim().length > 0) &&
    (!charging ||
      !complete ||
      (fields.cost != null &&
        Number.isFinite(fields.cost) &&
        fields.cost >= 0 &&
        (fields.kwh == null ||
          (Number.isFinite(fields.kwh) && fields.kwh > 0)) &&
        (fields.rate == null ||
          (Number.isFinite(fields.rate) && fields.rate >= 0)) &&
        (payer !== "guest" || payerGuest.trim().length > 0))) &&
    (!(unusual || unusualEnd) || confirmed) &&
    (!fields.inconsistent || acceptedCost);
  const allocation = (n: number) =>
    splitUsage({ possession, guest_name: guest } as RangeEvent, n, "idle", "")
      .map(
        (a) => `${name(a.participant)} ${a.km >= 0 ? "+" : ""}${km(a.km)} km`,
      )
      .join(" · ");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    const now = new Date().toISOString();
    // Date-only manual estimates use Jerusalem noon (DST resolved by helper).
    const occurred =
      manual && !editing
        ? new Date(
            Math.min(Date.parse(jerusalemNoon(day)), Date.parse(now)),
          ).toISOString()
        : event?.started_at || now;
    await onSave({
      ...event,
      kind: manual ? "manual" : charging ? "charge" : "drive",
      possession,
      guest_name: possession === "guest" ? guest.trim() : null,
      start_range: manual ? null : Number(start),
      end_range: manual || !complete ? null : Number(end),
      distance: manual ? Number(distance) : null,
      started_at: occurred,
      ended_at: complete ? event?.ended_at || (manual ? occurred : now) : null,
      duration_minutes: manual
        ? duration === ""
          ? null
          : Number(duration)
        : complete
          ? (event?.duration_minutes ??
            Math.max(0, (Date.parse(now) - Date.parse(occurred)) / 60000))
          : null,
      notes,
      charge_type: charging && complete ? chargeType : null,
      cost: charging && complete ? fields.cost : null,
      kwh: charging && complete ? fields.kwh : null,
      rate: charging && complete ? fields.rate : null,
      payer:
        charging && complete ? (payer as "danielle" | "maya" | "guest") : null,
      payer_guest_name:
        charging && complete && payer === "guest" ? payerGuest.trim() : null,
    });
  }
  return (
    <form onSubmit={submit} className="form-stack">
      {ending && event ? (
        <div className="soft-panel">
          <Metric
            label="Driver / possession"
            value={name(
              event.possession === "guest"
                ? `guest:${event.guest_name}`
                : event.possession,
            )}
          />
          <Metric label="Start range" value={`${km(event.start_range!)} km`} />
          <Metric label="Started" value={date(event.started_at)} />
        </div>
      ) : (
        <People
          value={possession}
          onChange={setPossession}
          guest={guest}
          onGuest={setGuest}
        />
      )}
      {manual ? (
        <>
          {editing ? (
            <Metric label="Date" value={date(event!.started_at)} />
          ) : (
            <Field
              label="Date"
              type="date"
              value={day}
              onChange={setDay}
              required
            />
          )}
          <Field
            label="Distance driven"
            value={distance}
            onChange={setDistance}
            suffix="km"
            required
          />
          <Field
            label="Duration (min)"
            value={duration}
            onChange={setDuration}
          />
          <p className="hint">
            Manual estimates add usage and reset the range baseline. The next
            tracked entry will not add parked loss.
          </p>
        </>
      ) : (
        <>
          {!ending && (
            <>
              <div className="field-heading">
                <span>
                  {editing ? "Start range" : "Current displayed range"}
                </span>
                <small>
                  {baseline == null
                    ? "New range baseline"
                    : `Last recorded: ${km(baseline)} km`}
                </small>
              </div>
              <Field
                label={editing ? "Start range" : "Current displayed range"}
                value={start}
                onChange={(v) => {
                  setStart(v);
                  setConfirmed(false);
                }}
                suffix="km"
                required
              />
              <p className="hint">
                Battery range shown by your Tesla, in kilometers.
              </p>
            </>
          )}
          {!complete && idle != null && (
            <div className="soft-panel mint">
              {idle === 0
                ? "No range change while parked."
                : `Parked ${idle > 0 ? "loss" : "range credit"} ${km(Math.abs(idle))} km → ${allocation(idle)}`}
            </div>
          )}
          {unusual && !confirmed && (
            <div className="warning">
              <strong>
                {idle! < 0
                  ? `The car gained ${km(-idle!)} km since the last entry. Was a charge missed?`
                  : `The car lost ${km(idle!)} km of range while parked. Please confirm this is correct.`}
              </strong>
              <div className="button-row">
                {idle! < 0 ? (
                  <button type="button" onClick={onMissed}>
                    Record Missed Charge
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setStart("");
                    }}
                  >
                    Correct Range
                  </button>
                )}
                <button type="button" onClick={() => setConfirmed(true)}>
                  Continue Anyway
                </button>
              </div>
            </div>
          )}
          {complete && (
            <>
              <Field
                label={
                  charging ? "Displayed range after charging" : "End range"
                }
                value={end}
                onChange={(v) => {
                  setEnd(v);
                  setConfirmed(false);
                }}
                suffix="km"
                required
              />
              {used != null && (
                <div className="soft-panel mint">
                  {charging ? (
                    <strong>Range added: {km(-used)} km</strong>
                  ) : (
                    <>
                      <small>RANGE USED</small>
                      <h2>
                        {used >= 0 ? "+" : ""}
                        {km(used)} km
                      </h2>
                      <span>{allocation(used)}</span>
                    </>
                  )}
                </div>
              )}
              {unusualEnd && !confirmed && (
                <div className="warning">
                  This range change is unusual. Please check the reading.
                  <button type="button" onClick={() => setConfirmed(true)}>
                    Continue Anyway
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
      {charging && complete && (
        <>
          <div className="field-grid">
            <Field
              label="Total cost"
              value={cost}
              onChange={(v) => {
                setCost(v);
                setAcceptedCost(false);
              }}
              suffix="₪"
              step="0.01"
            />
            <Field
              label="kWh"
              value={kwh}
              onChange={(v) => {
                setKwh(v);
                setAcceptedCost(false);
              }}
            />
            <Field
              label="₪/kWh"
              value={rate}
              onChange={(v) => {
                setRate(v);
                setAcceptedCost(false);
              }}
            />
          </div>
          {fields.cost != null && (
            <p className="hint">
              Total: {money(fields.cost)}
              {fields.kwh != null ? ` · ${km(fields.kwh)} kWh` : ""}
              {fields.rate != null ? ` · ₪${fields.rate.toFixed(3)}/kWh` : ""}
            </p>
          )}
          {fields.inconsistent && (
            <div className="warning">
              These figures do not match. Total cost stays authoritative.
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={acceptedCost}
                  onChange={(e) => setAcceptedCost(e.target.checked)}
                />
                Use entered total cost
              </label>
            </div>
          )}
          <People
            payer
            value={payer}
            onChange={setPayer}
            guest={payerGuest}
            onGuest={setPayerGuest}
          />
          <div className="field">
            <span>Charge type</span>
            <div className="people">
              {(["normal_full", "partial_emergency"] as const).map((t) => (
                <button
                  type="button"
                  className={chargeType === t ? "selected" : ""}
                  key={t}
                  aria-pressed={chargeType === t}
                  onClick={() => setChargeType(t)}
                >
                  {t === "normal_full"
                    ? "Normal / Full"
                    : "Partial / Emergency"}
                  <small>
                    {t === "normal_full" ? "Closes & settles" : "Stays pending"}
                  </small>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      {complete && (
        <label className="field">
          <span>
            Notes <small>optional</small>
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </label>
      )}
      <div className="button-row">
        {editing && onDelete && (
          <button
            type="button"
            className="button danger"
            onClick={onDelete}
            disabled={busy}
          >
            Delete
          </button>
        )}
        <button
          className={`button ${editing ? "dark" : charging ? "blue" : "green"}`}
          disabled={!valid || busy}
        >
          {busy
            ? "Saving…"
            : editing
              ? "Save Changes"
              : manual
                ? "Save Manual Estimate"
                : complete
                  ? charging
                    ? "Save & Finish"
                    : "Save & End Drive"
                  : charging
                    ? "Start Charge"
                    : "Start Drive"}
        </button>
      </div>
    </form>
  );
}
function jerusalemNoon(day: string) {
  const guess = new Date(`${day}T12:00:00Z`);
  const hour = Number(
    new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Jerusalem",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(guess),
  );
  return new Date(+guess - (hour - 12) * 3600000).toISOString();
}
