import type { SupabaseClient } from "@supabase/supabase-js";
import type { Snapshot } from "./types";

// Explicit allowlists: never serialize sessions, credentials, or future columns.
export const EVENT_FIELDS =
  "id,household_id,kind,possession,guest_name,start_range,end_range,distance,started_at,ended_at,duration_minutes,charge_type,cost,kwh,rate,payer,payer_guest_name,notes,is_demo,demo_batch_id,revision";
export const REPAYMENT_FIELDS =
  "id,household_id,payer,recipient,amount,occurred_at,notes,is_demo,demo_batch_id";

export async function readExportData(
  client: SupabaseClient,
  expected: Snapshot,
): Promise<Snapshot> {
  const householdId = expected.household.id;
  if (!householdId)
    throw new Error("Sign in and refresh your household before exporting.");
  const household = await client
    .from("households")
    .select("id,name")
    .eq("id", householdId)
    .single();
  if (household.error || !household.data)
    throw new Error(
      "Could not read your household. Please refresh and try again.",
    );
  async function readAll(table: "events" | "repayments", fields: string) {
    const rows: Record<string, unknown>[] = [];
    const ids = new Set<string>();
    let total: number | null = null;
    do {
      const result = await client
        .from(table)
        .select(fields, { count: "exact" })
        .eq("household_id", householdId)
        .order("id", { ascending: true })
        .range(rows.length, rows.length + 499);
      if (result.error || !result.data || typeof result.count !== "number")
        throw new Error(
          `Could not read all ${table}. No file was created. Please try again.`,
        );
      if (total !== null && total !== result.count)
        throw new Error(
          "Your data changed during export. Refresh and try again.",
        );
      total = result.count;
      for (const row of result.data as unknown as Record<string, unknown>[]) {
        if (
          typeof row.id !== "string" ||
          ids.has(row.id) ||
          row.household_id !== householdId
        )
          throw new Error(
            "Could not verify export completeness. Refresh and try again.",
          );
        ids.add(row.id);
        rows.push(row);
      }
      if (rows.length > total || (!result.data.length && rows.length < total))
        throw new Error("Incomplete export data. Refresh and try again.");
    } while (rows.length < total);
    return rows;
  }
  const [events, repayments] = await Promise.all([
    readAll("events", EVENT_FIELDS),
    readAll("repayments", REPAYMENT_FIELDS),
  ]);
  // The existing UI's derived state must describe exactly these complete source rows.
  // No settlement rebuilding, mutations, or snapshot RPCs are performed here.
  const canonical = (rows: object[], fields: string) =>
    JSON.stringify(
      [...rows]
        .sort((a, b) =>
          String((a as { id: string }).id).localeCompare(
            (b as { id: string }).id,
          ),
        )
        .map((row) =>
          fields.split(",").map((key) => (row as Record<string, unknown>)[key]),
        ),
    );
  if (
    canonical(events, EVENT_FIELDS) !==
      canonical(expected.events, EVENT_FIELDS) ||
    canonical(repayments, REPAYMENT_FIELDS) !==
      canonical(expected.repayments, REPAYMENT_FIELDS)
  ) {
    throw new Error(
      "Your data changed or is still loading. Refresh the app, then export again. No file was created.",
    );
  }
  return {
    household: household.data,
    events,
    repayments,
  } as unknown as Snapshot;
}
