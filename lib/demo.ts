import type { RangeEvent, Repayment } from "./types";
export const DEMO_BATCH = "20260901-0000-4000-8000-000000000001";
export function demoData() {
  const events: RangeEvent[] = [];
  let range = 400;
  let index = 0;
  const add = (
    month: number,
    day: number,
    kind: RangeEvent["kind"],
    possession: RangeEvent["possession"],
    used: number,
    extra: Partial<RangeEvent> = {},
  ) => {
    const start = new Date(Date.UTC(2026, month - 1, day, 9));
    const end = new Date(+start + 30 * 60000);
    const startRange = range;
    range = kind === "charge" ? 400 : range - used;
    const e: RangeEvent = {
      id: `demo-${++index}`,
      household_id: "demo",
      kind,
      possession,
      guest_name: null,
      start_range: startRange,
      end_range: range,
      distance: null,
      started_at: start.toISOString(),
      ended_at: end.toISOString(),
      duration_minutes: 30,
      charge_type: kind === "charge" ? "normal_full" : null,
      cost: kind === "charge" ? 50 : null,
      kwh: null,
      rate: null,
      payer: kind === "charge" ? "danielle" : null,
      payer_guest_name: null,
      notes: "Sample entry",
      is_demo: true,
      demo_batch_id: DEMO_BATCH,
      revision: 1,
      ...extra,
    };
    events.push(e);
  };
  // Real range endpoints generate every chart value; June 120/80, July 165/95.
  add(6, 2, "drive", "danielle", 50);
  add(6, 6, "drive", "maya", 30);
  add(6, 12, "drive", "shared", 40);
  add(6, 19, "drive", "danielle", 50);
  add(6, 24, "drive", "maya", 30);
  add(6, 28, "charge", "maya", 0, { cost: 50, payer: "maya" });
  add(7, 2, "drive", "danielle", 75);
  add(7, 6, "drive", "maya", 45);
  add(7, 12, "drive", "shared", 40);
  add(7, 19, "drive", "danielle", 70);
  add(7, 24, "drive", "maya", 30);
  add(7, 28, "charge", "danielle", 0, { cost: 65 });
  add(8, 2, "drive", "danielle", 45);
  add(8, 6, "drive", "maya", 55);
  add(8, 9, "charge", "maya", 0, {
    cost: 16,
    payer: "maya",
    charge_type: "partial_emergency",
  });
  add(8, 12, "drive", "shared", 40);
  add(8, 19, "drive", "danielle", 40);
  add(8, 24, "drive", "maya", 80);
  add(8, 30, "charge", "danielle", 0, { cost: 49 });
  add(9, 1, "drive", "danielle", 52);
  range -= 1;
  add(9, 2, "drive", "maya", 47);
  add(9, 3, "charge", "danielle", 0, { cost: 100 });
  add(9, 5, "drive", "shared", 20);
  add(9, 7, "charge", "maya", 0, {
    cost: 12,
    payer: "maya",
    charge_type: "partial_emergency",
  });
  add(9, 9, "drive", "danielle", 18);
  const repayments: Repayment[] = [
    {
      id: "demo-repayment",
      household_id: "demo",
      payer: "maya",
      recipient: "danielle",
      amount: 20,
      occurred_at: "2026-09-04T09:00:00Z",
      notes: "Part of September charging",
      is_demo: true,
      demo_batch_id: DEMO_BATCH,
    },
  ];
  return { events, repayments };
}
