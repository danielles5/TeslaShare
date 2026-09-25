import { describe, expect, it } from "vitest";
import { analytics, rebuildDerivedState } from "../lib/engine";
import { monthlyResponsibility, periodStats } from "../lib/dashboard-stats";
import { demoData } from "../lib/demo";
import type { RangeEvent } from "../lib/types";

function sequence(items: Partial<RangeEvent>[]): RangeEvent[] {
  return items.map((item, i) => ({
    id: `e${i}`,
    household_id: "h",
    kind: "drive",
    possession: "danielle",
    guest_name: null,
    start_range: 400,
    end_range: 400,
    distance: null,
    started_at: `2026-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
    ended_at: `2026-01-${String(i + 1).padStart(2, "0")}T11:00:00Z`,
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
    ...item,
  }));
}

describe("display-only open period stats", () => {
  it("sums Shared halves once and positive idle without allocating again", () => {
    const events = sequence([
      { end_range: 390 },
      { possession: "shared", start_range: 388, end_range: 368 },
      { possession: "maya", start_range: 367, end_range: 357 },
      { possession: "shared", start_range: 354, end_range: 354 },
      {
        possession: "shared",
        start_range: 356,
        end_range: null,
        ended_at: null,
      },
    ]);
    const derived = rebuildDerivedState(events);
    const before = structuredClone(derived);
    expect(periodStats(derived)).toEqual({
      lastRange: 354,
      drives: 4,
      idleLoss: 6,
      sharedContribution: 25,
    });
    expect(derived.open.usage).toEqual({ danielle: 21.5, maya: 22.5 });
    expect(derived).toEqual(before);
    const sharedOnly = rebuildDerivedState(
      sequence([{ possession: "shared", start_range: 340, end_range: 320 }]),
    );
    expect(periodStats(sharedOnly).sharedContribution).toBe(20);
    expect(sharedOnly.open.usage).toEqual({ danielle: 10, maya: 10 });
  });
  it("uses existing open boundaries, includes manual drives, excludes active drives, and preserves the latest tracked endpoint", () => {
    const events = sequence([
      { end_range: 380 },
      {
        kind: "charge",
        charge_type: "normal_full",
        start_range: 380,
        end_range: 450,
        cost: 40,
        payer: "maya",
      },
      {
        kind: "manual",
        possession: "shared",
        distance: 12,
        start_range: null,
        end_range: null,
      },
      { start_range: 430, end_range: 420 },
      {
        kind: "charge",
        charge_type: "partial_emergency",
        start_range: 418,
        end_range: 460,
        cost: 10,
        payer: "danielle",
      },
      { start_range: 459, end_range: null, ended_at: null },
    ]);
    const derived = rebuildDerivedState(events);
    expect(derived.settlements).toHaveLength(1);
    expect(periodStats(derived)).toEqual({
      lastRange: 460,
      drives: 2,
      idleLoss: 3,
      sharedContribution: 12,
    });
    expect(
      periodStats(rebuildDerivedState(JSON.parse(JSON.stringify(events)))),
    ).toEqual(periodStats(derived));
  });
});

describe("monthly display responsibility", () => {
  it("uses full precision rather than the displayed 58%/42%", () => {
    expect(monthlyResponsibility({ danielle: 80, maya: 58 }, 112)).toEqual({
      danielle: 64.93,
      maya: 47.07,
    });
  });
  it("conserves every agora with deterministic ties, including a single participant", () => {
    expect(monthlyResponsibility({ danielle: 1, maya: 1 }, 0.01)).toEqual({
      danielle: 0.01,
      maya: 0,
    });
    expect(monthlyResponsibility({ danielle: 0, maya: 20 }, 12.34)).toEqual({
      danielle: 0,
      maya: 12.34,
    });
    for (let cents = 0; cents < 1000; cents++) {
      const parts = monthlyResponsibility(
        { danielle: 80.125, maya: 58.875 },
        cents / 100,
      )!;
      expect(
        Math.round(parts.danielle * 100) + Math.round(parts.maya * 100),
      ).toBe(cents);
    }
  });
  it("matches the existing two-person comparison without changing guest accounting", () => {
    expect(
      monthlyResponsibility({ danielle: 3, maya: 1, "guest:Dad": 4 }, 100),
    ).toEqual({ danielle: 75, maya: 25 });
  });
  it("does not invent a usage share for spend without usage", () => {
    expect(monthlyResponsibility({ danielle: 0, maya: 0 }, 20)).toBeNull();
    expect(monthlyResponsibility({ danielle: 0, maya: 0 }, 0)).toEqual({
      danielle: 0,
      maya: 0,
    });
  });
  it("uses calendar analytics across settlement boundaries and leaves history, debt, repayments and payers untouched", () => {
    const data = demoData();
    const derived = rebuildDerivedState(data.events, data.repayments);
    const before = structuredClone({ data, derived });
    const filters = ["2026-06", "2026-07", "2026-08", "2026", "all"];
    const summaries = () =>
      filters.map((filter) => {
        const stats = analytics(
          data.events,
          derived.allocations,
          filter,
          new Date("2026-10-01T12:00:00Z"),
        );
        return { ...stats, paid: [stats.paid("danielle"), stats.paid("maya")] };
      });
    const oldStats = summaries();
    const august = analytics(
      data.events,
      derived.allocations,
      "2026-08",
      new Date("2026-10-01T12:00:00Z"),
    );
    expect(monthlyResponsibility(august.usage, august.spend)).toEqual({
      danielle: 26.25,
      maya: 38.75,
    });
    periodStats(derived);
    expect({ data, derived }).toEqual(before);
    expect(summaries()).toEqual(oldStats);
  });
});
