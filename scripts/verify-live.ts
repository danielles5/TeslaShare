import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import type { Snapshot } from "../lib/types.ts";
// This smoke check uses exact source IDs and a unique note for safe cleanup.
for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SEED_EMAIL",
  "SEED_PASSWORD",
]) {
  if (!process.env[key]) throw new Error(`Missing ${key} in .env.local`);
}
const client = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const { error: authError } = await client.auth.signInWithPassword({
  email: process.env.SEED_EMAIL!,
  password: process.env.SEED_PASSWORD!,
});
if (authError) throw new Error(`Sign in failed: ${authError.message}`);
async function snapshot(): Promise<Snapshot> {
  const { data, error } = await client.rpc("household_snapshot");
  if (error) throw new Error(error.message);
  return data;
}
async function write(
  action: string,
  payload: Record<string, unknown>,
): Promise<Snapshot> {
  const { data, error } = await client.rpc("mutate_household", {
    action,
    payload: { ...payload, request_id: randomUUID() },
  });
  if (error) throw new Error(error.message);
  return data;
}
const tag = `Temporary live verification ${randomUUID()}`;
const initial = await snapshot();
if (
  initial.events.some((e) => !e.is_demo) ||
  initial.repayments.some((r) => !r.is_demo)
) {
  console.log(
    "Authenticated connection and household snapshot passed. Existing real data detected; write checks skipped to preserve household accounting.",
  );
  await client.auth.signOut();
  process.exit(0);
}
const instant = (secondsAgo: number) =>
  new Date(Date.now() - secondsAgo * 1000).toISOString();
try {
  let data = await write("save_event", {
    kind: "drive",
    possession: "maya",
    start_range: 395,
    end_range: null,
    started_at: instant(120),
    ended_at: null,
    notes: tag,
  });
  let drive = data.events.find((e) => e.notes === tag)!;
  assert.ok(drive.id);
  assert.equal(
    (await snapshot()).events.find((e) => e.id === drive.id)?.ended_at,
    null,
  );
  data = await write("save_event", {
    ...drive,
    end_range: 360,
    ended_at: instant(60),
  });
  drive = data.events.find((e) => e.id === drive.id)!;
  assert.equal(drive.end_range, 360);
  data = await write("save_event", {
    kind: "charge",
    possession: "maya",
    start_range: 359,
    end_range: null,
    started_at: instant(30),
    ended_at: null,
    notes: tag,
  });
  let charge = data.events.find((e) => e.notes === tag && e.kind === "charge")!;
  assert.equal(
    (await snapshot()).events.find((e) => e.id === charge.id)?.ended_at,
    null,
  );
  data = await write("save_event", {
    ...charge,
    end_range: 400,
    ended_at: instant(10),
    charge_type: "normal_full",
    cost: 40,
    payer: "danielle",
  });
  charge = data.events.find((e) => e.id === charge.id)!;
  assert.equal(charge.cost, 40);
  data = await write("repay", {
    payer: "maya",
    recipient: "danielle",
    amount: 15,
    notes: tag,
  });
  assert.equal(
    (await snapshot()).repayments.find((r) => r.notes === tag)?.amount,
    15,
  );
  console.log(
    "Live Auth, household initialization, active drive/charge persistence, completion, and repayment persistence passed.",
  );
} finally {
  const saved = await snapshot();
  for (const r of saved.repayments.filter((r) => r.notes === tag))
    await write("delete_repayment", { id: r.id });
  for (const e of saved.events.filter((e) => e.notes === tag).reverse())
    await write("delete_event", { id: e.id, revision: e.revision });
  const final = await snapshot();
  assert.equal(final.events.filter((e) => e.notes === tag).length, 0);
  assert.equal(final.repayments.filter((r) => r.notes === tag).length, 0);
  console.log(
    "Live deletion and fresh-snapshot checks passed. Temporary verification records removed; existing data preserved.",
  );
  await client.auth.signOut();
}
