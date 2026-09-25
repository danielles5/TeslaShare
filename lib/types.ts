export type Possession = "danielle" | "maya" | "shared" | "guest";
export type Participant = Exclude<Possession, "shared">;
export type ChargeType = "normal_full" | "partial_emergency";
export type EventKind = "drive" | "charge" | "manual";
export interface RangeEvent {
  id: string;
  household_id: string;
  kind: EventKind;
  possession: Possession;
  guest_name: string | null;
  start_range: number | null;
  end_range: number | null;
  distance: number | null;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  charge_type: ChargeType | null;
  cost: number | null;
  kwh: number | null;
  rate: number | null;
  payer: Participant | null;
  payer_guest_name: string | null;
  notes: string;
  is_demo: boolean;
  demo_batch_id: string | null;
  revision: number;
}
export interface Repayment {
  id: string;
  household_id: string;
  payer: string;
  recipient: string;
  amount: number;
  occurred_at: string;
  notes: string;
  is_demo: boolean;
  demo_batch_id: string | null;
}
export interface Snapshot {
  household: { id: string; name: string };
  events: RangeEvent[];
  repayments: Repayment[];
}
export interface Allocation {
  source_id: string;
  source: "drive" | "idle" | "manual";
  participant: string;
  km: number;
  occurred_at: string;
  is_demo: boolean;
}
export interface Share {
  participant: string;
  km: number;
  percentage: number;
  responsibility: number;
  paid: number;
  net: number;
}
export interface Settlement {
  id: string;
  started_at: string;
  ended_at: string;
  cost: number;
  shares: Share[];
  events: RangeEvent[];
  allocations: Allocation[];
  is_demo: boolean;
}
