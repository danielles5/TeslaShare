import type {
  Allocation,
  RangeEvent,
  Repayment,
  Settlement,
  Share,
} from "./types";
import { calendarKey } from "./format";
export const participantKey = (person: string, guest: string | null) =>
  person === "guest" ? `guest:${guest?.trim() || "Guest"}` : person;
export function splitUsage(
  event: RangeEvent,
  amount: number,
  source: Allocation["source"],
  occurred_at: string,
): Allocation[] {
  const base = {
    source_id: event.id,
    source,
    occurred_at,
    is_demo: event.is_demo,
  };
  return event.possession === "shared"
    ? ["danielle", "maya"].map((participant) => ({
        ...base,
        participant,
        km: amount / 2,
      }))
    : [
        {
          ...base,
          participant: participantKey(event.possession, event.guest_name),
          km: amount,
        },
      ];
}
export function sumUsage(
  allocations: Allocation[],
  clamp = true,
): Record<string, number> {
  const values: Record<string, number> = { danielle: 0, maya: 0 };
  for (const a of allocations)
    values[a.participant] = (values[a.participant] || 0) + a.km;
  return Object.fromEntries(
    Object.entries(values).map(([p, n]) => [p, clamp ? Math.max(0, n) : n]),
  );
}
// Integer agora, largest remainder, lexical participant tie-break: exact conservation of money.
export function distribute(
  cost: number,
  usage: Record<string, number>,
): Record<string, number> {
  const entries = Object.entries(usage)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (!total) return {};
  const cents = Math.round(cost * 100);
  const parts = entries.map(([p, n]) => ({
    p,
    exact: (cents * n) / total,
    cents: Math.floor((cents * n) / total),
  }));
  let remainder = cents - parts.reduce((s, p) => s + p.cents, 0);
  for (const part of [...parts].sort(
    (a, b) => b.exact - b.cents - (a.exact - a.cents) || a.p.localeCompare(b.p),
  )) {
    if (remainder-- > 0) part.cents++;
  }
  return Object.fromEntries(parts.map((p) => [p.p, p.cents / 100]));
}
export function rebuildDerivedState(
  events: RangeEvent[],
  repayments: Repayment[] = [],
) {
  const sorted = [...events].sort(
    (a, b) =>
      Date.parse(a.started_at) - Date.parse(b.started_at) ||
      a.id.localeCompare(b.id),
  );
  const allocations: Allocation[] = [];
  const idle: Record<string, number> = {};
  // Compare real timestamp instants, including manual estimates inserted later.
  // A manual estimate breaks continuity until the next reliable range endpoint.
  for (const e of sorted) {
    if (e.kind === "manual") {
      allocations.push(
        ...splitUsage(e, e.distance || 0, "manual", e.started_at),
      );
      continue;
    }
    const stream = e.demo_batch_id || "real";
    const preceding = sorted
      .filter(
        (p) =>
          p.id !== e.id &&
          p.kind !== "manual" &&
          p.ended_at &&
          p.end_range != null &&
          (p.demo_batch_id || "real") === stream &&
          Date.parse(p.ended_at) <= Date.parse(e.started_at),
      )
      .sort(
        (a, b) =>
          Date.parse(a.ended_at!) - Date.parse(b.ended_at!) ||
          a.id.localeCompare(b.id),
      )
      .at(-1);
    const continuityBroken =
      preceding &&
      sorted.some(
        (p) =>
          p.kind === "manual" &&
          (p.demo_batch_id || "real") === stream &&
          Date.parse(p.started_at) >= Date.parse(preceding.ended_at!) &&
          Date.parse(p.started_at) <= Date.parse(e.started_at),
      );
    if (preceding && !continuityBroken && e.start_range != null) {
      idle[e.id] = preceding.end_range! - e.start_range;
      allocations.push(...splitUsage(e, idle[e.id], "idle", e.started_at));
    }
    if (e.kind === "drive" && e.ended_at && e.end_range != null) {
      allocations.push(
        ...splitUsage(
          e,
          (e.start_range || 0) - e.end_range,
          "drive",
          e.ended_at,
        ),
      );
    }
  }
  const settlements: Settlement[] = [];
  const pendingEvents: RangeEvent[] = [];
  const pendingAllocations: Allocation[] = [];
  for (const stream of new Set(sorted.map((e) => e.demo_batch_id || "real"))) {
    const streamEvents = sorted
      .filter((e) => (e.demo_batch_id || "real") === stream)
      .sort(
        (a, b) =>
          Date.parse(a.ended_at || a.started_at) -
            Date.parse(b.ended_at || b.started_at) ||
          (a.ended_at ? (a.kind === "charge" ? 1 : 0) : 2) -
            (b.ended_at ? (b.kind === "charge" ? 1 : 0) : 2) ||
          a.id.localeCompare(b.id),
      );
    let periodEvents: RangeEvent[] = [];
    let periodAllocations: Allocation[] = [];
    for (const e of streamEvents) {
      periodEvents.push(e);
      periodAllocations.push(
        ...allocations.filter((a) => a.source_id === e.id),
      );
      if (e.kind !== "charge" || e.charge_type !== "normal_full" || !e.ended_at)
        continue;
      const usage = sumUsage(periodAllocations);
      const total = Object.values(usage).reduce((s, n) => s + n, 0);
      // An empty boundary carries its costs and records forward until usage can allocate them.
      if (total <= 0) continue;
      const charges = periodEvents.filter(
        (e) => e.kind === "charge" && e.ended_at,
      );
      const cost =
        charges.reduce((s, e) => s + Math.round((e.cost || 0) * 100), 0) / 100;
      const responsibility = distribute(cost, usage);
      const paid: Record<string, number> = {};
      for (const c of charges) {
        const p = participantKey(c.payer!, c.payer_guest_name);
        paid[p] = (paid[p] || 0) + Math.round((c.cost || 0) * 100) / 100;
      }
      const shares: Share[] = [
        ...new Set([...Object.keys(usage), ...Object.keys(paid)]),
      ]
        .sort()
        .map((p) => ({
          participant: p,
          km: usage[p] || 0,
          percentage: ((usage[p] || 0) / total) * 100,
          responsibility: responsibility[p] || 0,
          paid: paid[p] || 0,
          net:
            Math.round(((paid[p] || 0) - (responsibility[p] || 0)) * 100) / 100,
        }));
      settlements.push({
        id: e.id,
        started_at: periodEvents[0].started_at,
        ended_at: e.ended_at,
        cost,
        shares,
        events: periodEvents,
        allocations: periodAllocations,
        is_demo: e.is_demo,
      });
      periodEvents = [];
      periodAllocations = [];
    }
    pendingEvents.push(...periodEvents);
    pendingAllocations.push(...periodAllocations);
  }
  const balances: Record<string, number> = { danielle: 0, maya: 0 };
  for (const s of settlements)
    for (const p of s.shares)
      balances[p.participant] =
        (balances[p.participant] || 0) + Math.round(p.net * 100);
  for (const r of repayments) {
    balances[r.payer] = (balances[r.payer] || 0) + Math.round(r.amount * 100);
    balances[r.recipient] =
      (balances[r.recipient] || 0) - Math.round(r.amount * 100);
  }
  for (const p of Object.keys(balances)) balances[p] /= 100;
  return {
    allocations,
    idle,
    settlements: settlements.sort(
      (a, b) => Date.parse(b.ended_at) - Date.parse(a.ended_at),
    ),
    balances,
    open: {
      events: pendingEvents,
      allocations: pendingAllocations,
      usage: sumUsage(pendingAllocations),
      cost: pendingEvents
        .filter((e) => e.kind === "charge" && e.ended_at)
        .reduce((s, e) => s + (e.cost || 0), 0),
    },
    active: sorted.find(
      (e) => e.kind !== "manual" && !e.ended_at && !e.is_demo,
    ),
    lastRange:
      sorted.filter((e) => e.end_range != null && e.ended_at).at(-1)
        ?.end_range ?? null,
  };
}
export function nextBaseline(events: RangeEvent[]) {
  const last = [...events]
    .filter((e) => !e.is_demo)
    .sort(
      (a, b) =>
        Date.parse(a.ended_at || a.started_at) -
          Date.parse(b.ended_at || b.started_at) ||
        Number(a.kind === "manual") - Number(b.kind === "manual") ||
        a.id.localeCompare(b.id),
    )
    .at(-1);
  return last?.kind === "manual" ? null : (last?.end_range ?? null);
}
export function analytics(
  events: RangeEvent[],
  allocations: Allocation[],
  filter: string,
  now = new Date(),
) {
  const thisMonth = calendarKey(now.toISOString());
  const matches = (s: string) =>
    Date.parse(s) <= now.getTime() &&
    (filter === "all" ||
      (filter.length === 4
        ? calendarKey(s).startsWith(filter)
        : calendarKey(s) === filter));
  const usage = sumUsage(allocations.filter((a) => matches(a.occurred_at)));
  const selected = events.filter((e) => e.ended_at && matches(e.ended_at));
  const charges = selected.filter((e) => e.kind === "charge");
  const spend = charges.reduce((s, e) => s + (e.cost || 0), 0);
  const total = Object.values(usage).reduce((s, n) => s + n, 0);
  return {
    usage,
    spend,
    paid: (p: string) =>
      charges
        .filter((e) => participantKey(e.payer!, e.payer_guest_name) === p)
        .reduce((s, e) => s + (e.cost || 0), 0),
    drives: selected.filter((e) => e.kind !== "charge").length,
    costPer100: total > 0 ? (spend / total) * 100 : null,
    thisMonth,
  };
}
export function chargeFields(cost: string, kwh: string, rate: string) {
  let c = cost === "" ? null : Number(cost),
    k = kwh === "" ? null : Number(kwh),
    r = rate === "" ? null : Number(rate);
  const inconsistent =
    c != null &&
    k != null &&
    r != null &&
    Math.abs(c - k * r) > Math.max(0.05, c * 0.01);
  if (c == null && k != null && r != null) c = Math.round(k * r * 100) / 100;
  if (k == null && c != null && r != null && r > 0) k = c / r;
  if (r == null && c != null && k != null && k > 0) r = c / k;
  return { cost: c, kwh: k, rate: r, inconsistent };
}
