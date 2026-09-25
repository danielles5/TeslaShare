import { describe, it, expect } from "vitest";
import {
  rebuildDerivedState,
  splitUsage,
  distribute,
  analytics,
  chargeFields,
  nextBaseline,
} from "../lib/engine";
import { demoData } from "../lib/demo";
import type { RangeEvent, Repayment } from "../lib/types";
let id = 0;
function event(o: Partial<RangeEvent> = {}): RangeEvent {
  const i = ++id;
  return {
    id: `e${i}`,
    household_id: "h",
    kind: "drive",
    possession: "danielle",
    guest_name: null,
    start_range: 400,
    end_range: 395,
    distance: null,
    started_at: `2026-01-${String(i).padStart(2, "0")}T10:00:00Z`,
    ended_at: `2026-01-${String(i).padStart(2, "0")}T11:00:00Z`,
    duration_minutes: 60,
    charge_type: null,
    cost: null,
    kwh: null,
    rate: null,
    payer: null,
    payer_guest_name: null,
    notes: "",
    is_demo: false,
    demo_batch_id: null,
    revision: 1,
    ...o,
  };
}
function sequence(items: Partial<RangeEvent>[]) {
  id = 0;
  return items.map((e) => event(e));
}
const charge = (
  cost: number,
  payer: "danielle" | "maya" = "danielle",
  type: "normal_full" | "partial_emergency" = "normal_full",
): Partial<RangeEvent> => ({
  kind: "charge",
  start_range: 200,
  end_range: 400,
  charge_type: type,
  cost,
  payer,
});
const repayment = (amount: number): Repayment => ({
  id: "r",
  household_id: "h",
  payer: "maya",
  recipient: "danielle",
  amount,
  occurred_at: "2026-02-01T12:00:00Z",
  notes: "",
  is_demo: false,
  demo_batch_id: null,
});
describe("range accounting", () => {
  it("regression: 395 → 394 → 360 gives Maya 35, never 33", () => {
    const r = rebuildDerivedState(
      sequence([
        { end_range: 395 },
        { possession: "maya", start_range: 394, end_range: 360 },
      ]),
    );
    expect(r.idle.e2).toBe(1);
    expect(r.open.usage.maya).toBe(35);
  });
  it.each([
    ["danielle", 390, 5, 0],
    ["shared", 391, 2, 2],
    ["maya", 397, 0, -2],
  ] as const)("allocates parked change to %s", (possession, start, d, m) => {
    const rows = sequence([
      { end_range: 395 },
      { possession, start_range: start, end_range: start },
    ]);
    const r = rebuildDerivedState(rows);
    const idle = r.allocations.filter((a) => a.source === "idle");
    expect(idle.find((a) => a.participant === "danielle")?.km || 0).toBe(d);
    expect(idle.find((a) => a.participant === "maya")?.km || 0).toBe(m);
  });
  it("guest Dad owns parked loss without a permanent participant", () => {
    const r = rebuildDerivedState(
      sequence([
        { end_range: 395 },
        {
          possession: "guest",
          guest_name: "Dad",
          start_range: 390,
          end_range: 390,
        },
      ]),
    );
    expect(r.open.usage["guest:Dad"]).toBe(5);
  });
  it("Shared conserves range: 340 → 320 is 10 + 10", () => {
    const r = rebuildDerivedState(
      sequence([{ possession: "shared", start_range: 340, end_range: 320 }]),
    );
    expect(r.open.usage).toEqual({ danielle: 10, maya: 10 });
  });
  it("every previous possession has no effect on next owner", () => {
    for (const prev of ["danielle", "maya", "shared", "guest"] as const) {
      const r = rebuildDerivedState(
        sequence([
          {
            possession: prev,
            guest_name: "Dad",
            start_range: 395,
            end_range: 395,
          },
          { possession: "maya", start_range: 390, end_range: 390 },
        ]),
      );
      expect(r.open.usage.maya).toBe(5);
    }
  });
  it("charge gain is not driving usage; pre-charge idle belongs to possession", () => {
    const r = rebuildDerivedState(
      sequence([
        { start_range: 395, end_range: 395 },
        {
          ...charge(20, "danielle", "partial_emergency"),
          possession: "maya",
          start_range: 390,
          end_range: 450,
        },
      ]),
    );
    expect(r.open.usage).toEqual({ danielle: 0, maya: 5 });
  });
  it("manual estimates break continuity until a real baseline", () => {
    const rows = sequence([
      { start_range: 390, end_range: 390 },
      { kind: "manual", start_range: null, end_range: null, distance: 20 },
      { start_range: 360, end_range: 350 },
      { possession: "maya", start_range: 348, end_range: 348 },
    ]);
    const r = rebuildDerivedState(rows);
    expect(r.idle.e3).toBeUndefined();
    expect(r.idle.e4).toBe(2);
    expect(r.open.usage.danielle).toBe(30);
    expect(nextBaseline(rows.slice(0, 2))).toBeNull();
  });
  it("clamps final billable usage, preserving signed source credits", () => {
    const r = rebuildDerivedState(
      sequence([{ start_range: 150, end_range: 153 }]),
    );
    expect(r.allocations[0].km).toBe(-3);
    expect(r.open.usage.danielle).toBe(0);
  });
  it("active session contributes parked usage immediately", () => {
    const r = rebuildDerivedState(
      sequence([
        { start_range: 395, end_range: 395 },
        {
          possession: "maya",
          start_range: 394,
          end_range: null,
          ended_at: null,
        },
      ]),
    );
    expect(r.active?.id).toBe("e2");
    expect(r.open.usage.maya).toBe(1);
  });
});
describe("settlements and ledger", () => {
  it("partial charge 20 + full 80: Danielle owes Maya 30", () => {
    const r = rebuildDerivedState(
      sequence([
        { start_range: 400, end_range: 300 },
        {
          ...charge(20, "danielle", "partial_emergency"),
          start_range: 300,
          end_range: 400,
        },
        { possession: "maya", start_range: 400, end_range: 300 },
        { ...charge(80, "maya"), start_range: 300 },
      ]),
    );
    expect(r.settlements).toHaveLength(1);
    expect(r.settlements[0].cost).toBe(100);
    expect(r.settlements[0].shares.map((p) => p.responsibility)).toEqual([
      50, 50,
    ]);
    expect(r.balances).toEqual({ danielle: -30, maya: 30 });
    expect(r.open.usage).toEqual({ danielle: 0, maya: 0 });
  });
  it("open usage and partial payments never change debt", () => {
    const r = rebuildDerivedState(
      sequence([
        { start_range: 400, end_range: 300 },
        { ...charge(20, "danielle", "partial_emergency"), start_range: 300 },
      ]),
    );
    expect(r.balances).toEqual({ danielle: 0, maya: 0 });
    expect(r.open.cost).toBe(20);
  });
  it("40 debt minus 15 minus 25 settles without changing history", () => {
    const rows = sequence([
      { possession: "maya", start_range: 400, end_range: 300 },
      { ...charge(40), start_range: 300 },
    ]);
    expect(rebuildDerivedState(rows, [repayment(15)]).balances.danielle).toBe(
      25,
    );
    const r = rebuildDerivedState(rows, [repayment(15), repayment(25)]);
    expect(r.balances.danielle).toBe(0);
    expect(r.settlements).toHaveLength(1);
    expect(rebuildDerivedState(rows).balances.danielle).toBe(40);
  });
  it("exact agora remainder and no negative responsibility", () => {
    expect(distribute(0.01, { danielle: 1, maya: 1 })).toEqual({
      danielle: 0.01,
      maya: 0,
    });
    for (let cost = 1; cost < 100; cost++) {
      const parts = distribute(cost / 100, {
        danielle: 3,
        maya: 7,
        "guest:Dad": 1,
      });
      expect(
        Math.round(Object.values(parts).reduce((a, b) => a + b, 0) * 100),
      ).toBe(cost);
    }
  });
  it("zero usage costs remain pending and settle with later usage", () => {
    const rows = sequence([
      { ...charge(10), start_range: 400, end_range: 400 },
    ]);
    const first = rebuildDerivedState(rows);
    expect(first.settlements).toHaveLength(0);
    expect(first.open.cost).toBe(10);
    rows.push(
      event({ start_range: 400, end_range: 300 }),
      event({ ...charge(20), start_range: 300 }),
    );
    expect(rebuildDerivedState(rows).settlements[0].cost).toBe(30);
  });
  it("payer is independent of possession; guests retain their own responsibility", () => {
    const r = rebuildDerivedState(
      sequence([
        {
          possession: "guest",
          guest_name: "Dad",
          start_range: 400,
          end_range: 300,
        },
        { ...charge(50), possession: "maya", start_range: 300 },
      ]),
    );
    expect(r.balances).toEqual({ danielle: 50, maya: 0, "guest:Dad": -50 });
  });
  it("deletion rebuilds adjacency and removes the deleted source allocations", () => {
    const rows = sequence([
      { start_range: 300, end_range: 300 },
      { start_range: 299, end_range: 295 },
      { possession: "maya", start_range: 292, end_range: 290 },
    ]);
    const r = rebuildDerivedState(rows.filter((e) => e.id !== "e2"));
    expect(r.idle.e3).toBe(8);
    expect(r.allocations.some((a) => a.source_id === "e2")).toBe(false);
  });
  it("deleting full boundary merges into later settlement, then open period", () => {
    const rows = sequence([
      { start_range: 400, end_range: 300 },
      { ...charge(20), start_range: 300 },
      { possession: "maya", start_range: 400, end_range: 300 },
      { ...charge(40), start_range: 300 },
    ]);
    expect(rebuildDerivedState(rows).settlements).toHaveLength(2);
    const after = rows.filter((e) => e.id !== "e2");
    expect(rebuildDerivedState(after).settlements).toHaveLength(1);
    expect(
      rebuildDerivedState(after.filter((e) => e.id !== "e4")).settlements,
    ).toHaveLength(0);
  });
  it("edit recomputes payer and liability", () => {
    const rows = sequence([
      { possession: "maya", start_range: 400, end_range: 300 },
      { ...charge(40), start_range: 300 },
    ]);
    expect(rebuildDerivedState(rows).balances.danielle).toBe(40);
    rows[1].payer = "maya";
    expect(rebuildDerivedState(rows).balances.danielle).toBe(0);
  });
});
describe("calendar analytics and demo isolation", () => {
  it("January/February history survives closed settlements", () => {
    const rows = sequence([
      { kind: "manual", start_range: null, end_range: null, distance: 300 },
      {
        kind: "manual",
        possession: "maya",
        start_range: null,
        end_range: null,
        distance: 200,
      },
      { ...charge(100), start_range: 100 },
    ]);
    rows.push(
      event({
        kind: "manual",
        start_range: null,
        end_range: null,
        distance: 100,
        started_at: "2026-02-01T10:00:00Z",
        ended_at: "2026-02-01T10:00:00Z",
      }),
      event({
        kind: "manual",
        possession: "maya",
        start_range: null,
        end_range: null,
        distance: 100,
        started_at: "2026-02-02T10:00:00Z",
        ended_at: "2026-02-02T10:00:00Z",
      }),
      event({
        ...charge(50),
        started_at: "2026-02-03T10:00:00Z",
        ended_at: "2026-02-03T11:00:00Z",
      }),
    );
    const r = rebuildDerivedState(rows);
    expect(r.open.usage).toEqual({ danielle: 0, maya: 0 });
    const jan = analytics(rows, r.allocations, "2026-01");
    expect(jan.usage).toEqual({ danielle: 300, maya: 200 });
    expect(jan.spend).toBe(100);
    for (const filter of ["2026", "all"]) {
      const a = analytics(rows, r.allocations, filter);
      expect(a.usage).toEqual({ danielle: 400, maya: 300 });
      expect(a.spend).toBe(150);
    }
  });
  it("Asia/Jerusalem midnight determines calendar month", () => {
    const rows = sequence([
      {
        start_range: 400,
        end_range: 390,
        started_at: "2026-01-31T22:10:00Z",
        ended_at: "2026-01-31T22:30:00Z",
      },
    ]);
    const r = rebuildDerivedState(rows);
    expect(analytics(rows, r.allocations, "2026-02").usage.danielle).toBe(10);
  });
  it("demo derives the requested month proportions and August partial cost", () => {
    const d = demoData(),
      r = rebuildDerivedState(d.events, d.repayments);
    for (const [month, danielle, maya, spend] of [
      ["2026-06", 120, 80, 50],
      ["2026-07", 165, 95, 65],
      ["2026-08", 105, 155, 65],
    ] as const) {
      const a = analytics(d.events, r.allocations, month);
      expect(a.usage).toEqual({ danielle, maya });
      expect(a.spend).toBe(spend);
    }
    const september = r.settlements.find((s) =>
      s.ended_at.startsWith("2026-09"),
    )!;
    expect(
      september.shares.find((p) => p.participant === "maya")?.responsibility,
    ).toBe(48);
  });
  it("demo never connects to real ranges; cleanup leaves real sources intact", () => {
    const demo = demoData();
    const real = sequence([
      {
        start_range: 50,
        end_range: 40,
        started_at: "2026-09-08T10:00:00Z",
        ended_at: "2026-09-08T11:00:00Z",
      },
    ]);
    const all = [...demo.events, ...real];
    const mixed = rebuildDerivedState(all);
    expect(
      mixed.allocations.filter((a) => !a.is_demo).reduce((s, a) => s + a.km, 0),
    ).toBe(10);
    const clean = rebuildDerivedState(all.filter((e) => !e.is_demo));
    expect(clean.open.usage).toEqual({ danielle: 10, maya: 0 });
    expect(clean.settlements).toHaveLength(0);
  });
  it("charge two-of-three fields derive without overriding entered cost", () => {
    expect(chargeFields("20", "", "2").kwh).toBe(10);
    expect(chargeFields("", "10", "2").cost).toBe(20);
    expect(chargeFields("20", "10", "").rate).toBe(2);
    expect(chargeFields("25", "10", "2")).toMatchObject({
      cost: 25,
      kwh: 10,
      rate: 2,
      inconsistent: true,
    });
  });
});

it("backdated manual usage inside a full charge settles at its ending boundary", () => {
  const rows = sequence([
    {
      ...charge(30),
      start_range: 300,
      end_range: 400,
      started_at: "2026-01-02T10:00:00Z",
      ended_at: "2026-01-02T11:00:00Z",
    },
    {
      kind: "manual",
      start_range: null,
      end_range: null,
      distance: 20,
      started_at: "2026-01-02T10:30:00Z",
      ended_at: "2026-01-02T10:30:00Z",
    },
    {
      start_range: 395,
      end_range: 390,
      started_at: "2026-01-03T10:00:00Z",
      ended_at: "2026-01-03T11:00:00Z",
    },
  ]);
  const result = rebuildDerivedState(rows);
  expect(
    result.settlements[0].shares.find((p) => p.participant === "danielle")?.km,
  ).toBe(20);
  expect(result.idle.e3).toBe(5);
  expect(result.open.usage.danielle).toBe(10);
});

it("manual break wins an equal-timestamp baseline tie in both preview and accounting", () => {
  const rows = sequence([
    {
      id: "z",
      start_range: 400,
      end_range: 390,
      started_at: "2026-01-01T10:00:00Z",
      ended_at: "2026-01-01T11:00:00Z",
    },
    {
      id: "a",
      kind: "manual",
      start_range: null,
      end_range: null,
      distance: 20,
      started_at: "2026-01-01T11:00:00Z",
      ended_at: "2026-01-01T11:00:00Z",
    },
  ]);
  expect(nextBaseline(rows)).toBeNull();
  rows.push(event({ start_range: 360, end_range: 350 }));
  expect(rebuildDerivedState(rows).idle[rows[2].id]).toBeUndefined();
});
