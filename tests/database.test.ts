import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { demoData } from "../lib/demo";
import { rebuildDerivedState } from "../lib/engine";
import type { Snapshot } from "../lib/types";
let pg: PGlite;
const owner = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002";
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;insert into auth.users values('${owner}'),('${other}');`,
  );
  await pg.exec(
    readFileSync("supabase/migrations/202609230001_initial.sql", "utf8"),
  );
  await pg.exec(`set role authenticated;set request.jwt.claim.sub='${owner}';`);
}, 30000);
afterAll(async () => {
  await pg.close();
});
async function snap() {
  return (
    await pg.query<{ data: Snapshot }>(
      "select public.household_snapshot() as data",
    )
  ).rows[0].data;
}
async function mutate(action: string, payload: unknown = {}) {
  return (
    await pg.query<{ data: Snapshot }>(
      "select public.mutate_household($1,$2::jsonb) as data",
      [action, JSON.stringify(payload)],
    )
  ).rows[0].data;
}
const drive = {
  kind: "drive",
  possession: "maya",
  start_range: 395,
  end_range: null,
  started_at: "2026-01-01T10:00:00Z",
  ended_at: null,
};
describe("real PostgreSQL migration, RLS and atomic mutations", () => {
  it("initializes only the signed-in owner household idempotently", async () => {
    const first = await snap();
    expect((await snap()).household.id).toBe(first.household.id);
    expect(first.events).toEqual([]);
  });
  it("persists active sessions; blocks another drive or charge", async () => {
    const saved = await mutate("save_event", drive);
    expect(saved.events[0].ended_at).toBeNull();
    expect((await snap()).events).toHaveLength(1);
    await expect(
      mutate("save_event", {
        ...drive,
        kind: "charge",
        started_at: "2026-01-01T11:00:00Z",
      }),
    ).rejects.toThrow();
  });
  it("rejects stale revisions and completes atomically", async () => {
    const e = (await snap()).events[0];
    await expect(
      mutate("save_event", {
        ...e,
        revision: 0,
        end_range: 360,
        ended_at: "2026-01-01T11:00:00Z",
      }),
    ).rejects.toThrow(/changed/);
    await expect(
      mutate("save_event", {
        id: e.id,
        end_range: 360,
        ended_at: "2026-01-01T11:00:00Z",
      }),
    ).rejects.toThrow(/changed/);
    const s = await mutate("save_event", {
      ...e,
      end_range: 360,
      ended_at: "2026-01-01T11:00:00Z",
    });
    expect(s.events[0].revision).toBe(2);
    expect(rebuildDerivedState(s.events).open.usage.maya).toBe(35);
  });
  it("enforces guest names and required charge payment fields", async () => {
    await expect(
      mutate("save_event", {
        ...drive,
        started_at: "2026-01-02T10:00:00Z",
        possession: "guest",
      }),
    ).rejects.toThrow();
    await expect(
      mutate("save_event", {
        ...drive,
        kind: "charge",
        started_at: "2026-01-02T10:00:00Z",
        ended_at: "2026-01-02T11:00:00Z",
        end_range: 400,
      }),
    ).rejects.toThrow();
  });
  it("rejects direct writes; RLS hides records from another owner", async () => {
    await expect(pg.exec(`delete from public.events`)).rejects.toThrow(
      /permission denied/,
    );
    await pg.exec(`set request.jwt.claim.sub='${other}'`);
    expect((await snap()).events).toHaveLength(0);
    expect((await pg.query("select * from public.events")).rows).toHaveLength(
      0,
    );
    await pg.exec(`set request.jwt.claim.sub='${owner}'`);
    expect((await snap()).events).toHaveLength(1);
  });
  it("demo loads once and cleanup removes only its batch", async () => {
    const before = (await snap()).events[0];
    const one = await mutate("load_demo", demoData());
    const two = await mutate("load_demo", demoData());
    expect(two.events.length).toBe(one.events.length);
    expect(
      two.events.filter((e) => e.is_demo).every((e) => e.demo_batch_id),
    ).toBe(true);
    const cleaned = await mutate("delete_demo");
    expect(cleaned.events).toEqual([before]);
    expect(cleaned.repayments).toEqual([]);
    expect((await snap()).events).toHaveLength(1);
  });
  it("deletes real source row and rebuilt allocations stay gone on fresh snapshot", async () => {
    const s = await snap();
    const e = s.events[0];
    await mutate("delete_event", { id: e.id, revision: e.revision });
    const refreshed = await snap();
    expect(refreshed.events).toHaveLength(0);
    expect(rebuildDerivedState(refreshed.events).allocations).toHaveLength(0);
  });
  it("charge deletion removes the boundary; repayment deletion updates ledger", async () => {
    let s = await mutate("save_event", {
      ...drive,
      end_range: 360,
      ended_at: "2026-01-01T11:00:00Z",
    });
    s = await mutate("save_event", {
      kind: "charge",
      possession: "maya",
      start_range: 360,
      end_range: 400,
      started_at: "2026-01-02T10:00:00Z",
      ended_at: "2026-01-02T11:00:00Z",
      charge_type: "normal_full",
      cost: 40,
      payer: "danielle",
    });
    expect(rebuildDerivedState(s.events).balances.danielle).toBe(40);
    s = await mutate("repay", {
      payer: "maya",
      recipient: "danielle",
      amount: 15,
    });
    expect(rebuildDerivedState(s.events, s.repayments).balances.danielle).toBe(
      25,
    );
    s = await mutate("delete_repayment", { id: s.repayments[0].id });
    expect(rebuildDerivedState(s.events, s.repayments).balances.danielle).toBe(
      40,
    );
    const c = s.events.find((e) => e.kind === "charge")!;
    s = await mutate("delete_event", { id: c.id, revision: c.revision });
    expect(rebuildDerivedState(s.events).settlements).toHaveLength(0);
    expect((await snap()).events.some((e) => e.id === c.id)).toBe(false);
  });
  it("retrying the same repayment request cannot double the ledger entry", async () => {
    const payload = {
      payer: "maya",
      recipient: "danielle",
      amount: 5,
      request_id: "30000000-0000-4000-8000-000000000001",
    };
    const first = await mutate("repay", payload);
    const retry = await mutate("repay", payload);
    expect(retry.repayments).toEqual(first.repayments);
    expect(retry.repayments).toHaveLength(1);
    await mutate("delete_repayment", { id: retry.repayments[0].id });
  });
  it("unauthenticated callers cannot execute household functions", async () => {
    await pg.exec("reset role;set role anon;");
    await expect(snap()).rejects.toThrow(/permission denied/);
  });
});
