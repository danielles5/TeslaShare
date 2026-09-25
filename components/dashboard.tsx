"use client";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { analytics, rebuildDerivedState } from "@/lib/engine";
import { calendarKey, date, km, money, monthLabel, name } from "@/lib/format";
import type { Snapshot, Settlement } from "@/lib/types";
import { DemoBadge, Metric } from "./ui";
export function Donut({
  usage,
  label,
  compact = false,
}: {
  usage: Record<string, number>;
  label: string;
  compact?: boolean;
}) {
  const d = usage.danielle || 0,
    m = usage.maya || 0,
    total = d + m,
    percent = total ? (d / total) * 100 : 0;
  return (
    <>
      {!compact && (
        <div
          className="donut"
          role="img"
          aria-label={`${label}: Danielle ${km(d)} km, Maya ${km(m)} km`}
          style={{
            background: total
              ? `conic-gradient(var(--danielle) 0 ${percent}%, var(--maya) ${percent}% 100%)`
              : "var(--border)",
          }}
        >
          <div>
            <small>{label}</small>
            <strong>
              {km(total)} <span>km</span>
            </strong>
          </div>
        </div>
      )}
      <p className="chart-caption">Danielle vs Maya</p>
      <div className="legend totals">
        {["danielle", "maya"].map((p) => (
          <div key={p}>
            <span>
              <i style={{ background: `var(--${p})` }} />
              {name(p)}
            </span>
            <strong>{km(usage[p] || 0)} km</strong>
            <small>
              {total ? Math.round(((usage[p] || 0) / total) * 100) : 0}%
            </small>
          </div>
        ))}
      </div>
      {Object.entries(usage)
        .filter(([p, n]) => p.startsWith("guest:") && n !== 0)
        .map(([p, n]) => (
          <Metric key={p} label={name(p)} value={`${km(n)} km`} />
        ))}
    </>
  );
}
export function SettlementRows({
  settlements,
  onSelect,
}: {
  settlements: Settlement[];
  onSelect: (s: Settlement) => void;
}) {
  return (
    <div className="settlement-list">
      {settlements.length ? (
        settlements.map((s) => (
          <button
            className="card settlement-row"
            key={s.id}
            onClick={() => onSelect(s)}
          >
            <div>
              <strong>
                {date(s.ended_at).split(" at")[0]}{" "}
                {calendarKey(s.ended_at).slice(0, 4)}
              </strong>
              <small>
                {s.shares.filter((p) => p.km || p.paid).length} participants{" "}
                {s.is_demo && <DemoBadge />}
              </small>
            </div>
            <span>
              View <ChevronRight size={16} />
            </span>
          </button>
        ))
      ) : (
        <div className="card empty">
          Your first normal/full charge will create a settlement.
        </div>
      )}
    </div>
  );
}
export function Dashboard({
  data,
  derived,
  onSettlement,
}: {
  data: Snapshot;
  derived: ReturnType<typeof rebuildDerivedState>;
  onSettlement: (s: Settlement) => void;
}) {
  const [tab, setTab] = useState("period");
  const thisMonth = calendarKey(new Date().toISOString());
  const [selected, setSelected] = useState(thisMonth);
  const year = thisMonth.slice(0, 4);
  const dates = [
    ...data.events.map((e) => calendarKey(e.started_at)),
    thisMonth,
  ].sort();
  const first = dates[0];
  const months: string[] = [];
  const cursor = new Date(`${first}-01T12:00:00Z`);
  const end = new Date(`${thisMonth}-01T12:00:00Z`);
  while (cursor <= end && months.length < 1200) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  while (months.length < 6) {
    const d = new Date(`${months[0]}-01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    months.unshift(d.toISOString().slice(0, 7));
  }
  const stats = analytics(
    data.events,
    derived.allocations,
    tab === "month" ? selected : tab === "year" ? year : "all",
  );
  return (
    <>
      <h1>Dashboard</h1>
      <div
        className="dashboard-tabs"
        role="group"
        aria-label="Analytics period"
      >
        {[
          ["period", "This Charging Period"],
          ["month", "Monthly Breakdown"],
          ["year", "This Year"],
          ["all", "All Time"],
        ].map(([v, l]) => (
          <button
            key={v}
            aria-pressed={tab === v}
            className={tab === v ? "selected" : ""}
            onClick={() => setTab(v)}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "period" ? (
        <>
          <section className="card">
            <h3>This charging period</h3>
            <Donut usage={derived.open.usage} label="RANGE USED" />
            <div className="divider" />
            <Metric
              label="Pending charging cost"
              value={money(derived.open.cost)}
            />
            <Metric label="Cost / 100 km" value="—" />
            <p className="hint">
              Responsibility is finalized at the next normal/full charge.
              Zero-usage charges remain pending.
            </p>
          </section>
          <section className="card">
            <Metric
              label="Last logged range"
              value={
                derived.lastRange == null ? "—" : `${km(derived.lastRange)} km`
              }
            />
          </section>
        </>
      ) : (
        <>
          {tab === "month" && (
            <section className="card">
              <h3>Monthly breakdown</h3>
              <div className="legend">
                <span>
                  <i className="danielle" />
                  Danielle
                </span>
                <span>
                  <i className="maya" />
                  Maya
                </span>
              </div>
              <div
                className="month-scroll"
                ref={(el) => {
                  if (el && !el.dataset.positioned) {
                    el.scrollLeft = el.scrollWidth;
                    el.dataset.positioned = "true";
                  }
                }}
              >
                <div className="month-bars">
                  {months.map((key) => {
                    const u = analytics(
                      data.events,
                      derived.allocations,
                      key,
                    ).usage;
                    const total = u.danielle + u.maya;
                    const pct = total ? (u.danielle / total) * 100 : 0;
                    return (
                      <button
                        key={key}
                        aria-label={`${monthLabel(key, true)}: Danielle ${Math.round(pct)}%, Maya ${total ? Math.round(100 - pct) : 0}%`}
                        aria-pressed={selected === key}
                        className={selected === key ? "selected" : ""}
                        onClick={() => setSelected(key)}
                      >
                        <div className="month-bar">
                          {total > 0 && (
                            <>
                              <div
                                className="danielle"
                                style={{ height: `${pct}%` }}
                              />
                              <div
                                className="maya"
                                style={{ height: `${100 - pct}%` }}
                              />
                            </>
                          )}
                        </div>
                        <span>{monthLabel(key)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="chart-caption">Tap a month · scroll for older</p>
            </section>
          )}
          <section className="card">
            <h3>
              {tab === "month"
                ? monthLabel(selected, true)
                : tab === "year"
                  ? "This year"
                  : "All time"}
            </h3>
            <Donut
              usage={stats.usage}
              compact={tab === "month"}
              label={
                tab === "year"
                  ? year
                  : tab === "all"
                    ? "ALL TIME"
                    : monthLabel(selected).toUpperCase()
              }
            />
            <div className="divider" />
            <Metric label="Charging spend" value={money(stats.spend)} />
            <Metric
              label="Danielle paid"
              value={money(stats.paid("danielle"))}
            />
            <Metric label="Maya paid" value={money(stats.paid("maya"))} />
            <Metric label="Drives" value={stats.drives} />
            <Metric
              label="Cost / 100 km"
              value={
                stats.costPer100 == null
                  ? "—"
                  : `${money(stats.costPer100)} / 100 km`
              }
            />
          </section>
        </>
      )}
      <h4 className="section-label">Recent settlements</h4>
      <SettlementRows
        settlements={derived.settlements.slice(0, 5)}
        onSelect={onSettlement}
      />
    </>
  );
}
export function SettlementDetail({
  settlement: s,
  derived,
  onBack,
}: {
  settlement: Settlement;
  derived: ReturnType<typeof rebuildDerivedState>;
  onBack: () => void;
}) {
  return (
    <>
      <button className="back-link" onClick={onBack}>
        ← Back
      </button>
      <h1>Settlement</h1>
      <p className="subtitle">
        {date(s.started_at).split(" at")[0]} –{" "}
        {date(s.ended_at).split(" at")[0]}
      </p>
      <section className="card">
        <h3>Participants</h3>
        {s.shares
          .filter((p) => p.km || p.paid)
          .map((p) => (
            <div className="soft-panel participant" key={p.participant}>
              <div className="between">
                <strong>{name(p.participant)}</strong>
                <small>
                  {Math.round(p.percentage)}% · {km(p.km)} km
                </small>
              </div>
              <Metric label="Responsible for" value={money(p.responsibility)} />
              <Metric label="Actually paid" value={money(p.paid)} />
              <Metric
                label={p.net >= 0 ? "Should receive" : "Owes"}
                value={money(Math.abs(p.net))}
              />
            </div>
          ))}
        <div className="divider" />
        <Metric label="Total charging cost" value={money(s.cost)} />
      </section>
      {["drive", "charge"].map((kind) => (
        <section className="card" key={kind}>
          <h3>
            {kind === "drive" ? "Drives" : "Charges"} (
            {
              s.events.filter((e) =>
                kind === "drive" ? e.kind !== "charge" : e.kind === "charge",
              ).length
            }
            )
          </h3>
          {s.events
            .filter((e) =>
              kind === "drive" ? e.kind !== "charge" : e.kind === "charge",
            )
            .map((e) => (
              <div className="soft-panel" key={e.id}>
                <div className="between">
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
                  </strong>
                  <small>{date(e.started_at)}</small>
                </div>
                <p className="hint">
                  {e.kind === "manual"
                    ? `Manual Estimate · ${km(e.distance || 0)} km`
                    : `${km(e.start_range!)} → ${km(e.end_range!)} km`}
                  {e.kind === "drive"
                    ? ` · used ${km(e.start_range! - e.end_range!)} km`
                    : ""}
                  {derived.idle[e.id]
                    ? ` · idle ${derived.idle[e.id] > 0 ? "+" : ""}${km(derived.idle[e.id])} km`
                    : ""}
                </p>
                {e.kind === "charge" && (
                  <p>
                    {money(e.cost!)} · paid by{" "}
                    {name(
                      e.payer === "guest"
                        ? `guest:${e.payer_guest_name}`
                        : e.payer!,
                    )}
                  </p>
                )}
              </div>
            ))}
        </section>
      ))}
    </>
  );
}
