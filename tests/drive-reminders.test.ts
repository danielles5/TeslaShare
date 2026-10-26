import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
import {
  deliverClaim,
  thresholdMinutes,
  validEndpoint,
  validSubscription,
} from "../supabase/functions/drive-reminders/core";
let pg: PGlite;
const owner = randomUUID(),
  other = randomUUID(),
  h = randomUUID();
const subscription = (name: string) => ({
  endpoint: `https://web.push.apple.com/${name}`,
  keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
});
async function register(
  person: string,
  name = person,
  id: string = randomUUID(),
) {
  return (
    await pg.query<{
      d: { id: string; participant: string; enabled: boolean };
    }>("select drive_push_device('register',$1,$2::jsonb,$3) d", [
      id,
      JSON.stringify(subscription(name)),
      person,
    ])
  ).rows[0].d;
}
async function event(person = "danielle", minutes = 46, kind = "drive") {
  return (
    await pg.query<{ id: string }>(
      `insert into events(household_id,kind,possession,guest_name,start_range,started_at) values($1,$2,$3,'Visitor',400,now()-make_interval(mins=>$4)) returning id`,
      [h, kind, person, minutes],
    )
  ).rows[0].id;
}
const claims = async () =>
  (
    await pg.query<{
      id: string;
      drive_id: string;
      device_id: string;
      participant: string;
    }>("select * from claim_drive_reminders(45)")
  ).rows;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; insert into auth.users values('${owner}'),('${other}');`,
  );
  await pg.exec(
    readFileSync("supabase/migrations/202609230001_initial.sql", "utf8"),
  );
  await pg.exec(
    `insert into households(id,owner_user_id) values('${h}','${owner}'); set request.jwt.claim.sub='${owner}';`,
  );
  // Real historical business rows exist BEFORE applying the additive migration.
  await pg.exec(
    `insert into events(household_id,kind,possession,start_range,end_range,started_at,ended_at) values('${h}','drive','shared',400,380,now()-interval '2 months',now()-interval '2 months'+interval '20 minutes'); insert into repayments(household_id,payer,recipient,amount) values('${h}','danielle','maya',12.34);`,
  );
  const before = await pg.query("select to_jsonb(e) data from events e");
  const money = await pg.query("select to_jsonb(r) data from repayments r");
  await pg.exec(
    readFileSync(
      "supabase/migrations/202610260001_drive_reminders.sql",
      "utf8",
    ),
  );
  expect(
    (await pg.query("select to_jsonb(e) data from events e")).rows,
  ).toEqual(before.rows);
  expect(
    (await pg.query("select to_jsonb(r) data from repayments r")).rows,
  ).toEqual(money.rows);
  expect(
    (
      await pg.query<{ enabled: boolean }>(
        "select enabled from drive_reminder_settings",
      )
    ).rows[0].enabled,
  ).toBe(false);
}, 30000);
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await pg.exec(
    `reset role; set request.jwt.claim.sub='${owner}'; delete from drive_reminder_deliveries; delete from drive_push_devices; delete from events where started_at>now()-interval '1 day'; update drive_reminder_settings set enabled=true,activated_at=now()-interval '2 hours';`,
  );
});
it.each(["danielle", "maya", "shared", "guest"])(
  "routes %s using stored possession only",
  async (person) => {
    const d = await register("danielle"),
      m = await register("maya");
    await event(person);
    const rows = await claims();
    expect(rows.map((r) => r.device_id).sort()).toEqual(
      (person === "shared"
        ? [d.id, m.id]
        : person === "guest"
          ? []
          : [person === "danielle" ? d.id : m.id]
      ).sort(),
    );
    expect(await claims()).toEqual([]);
  },
);
it("does not notify early, during charge, before cutoff, when completed, disabled or expired", async () => {
  await register("danielle");
  const id = await event("danielle", 20);
  expect(await claims()).toEqual([]);
  await pg.exec(
    `update events set started_at=now()-interval '46 minutes',kind='charge' where id='${id}'`,
  );
  expect(await claims()).toEqual([]);
  await pg.exec(
    `update events set kind='drive',started_at=now()-interval '3 hours' where id='${id}'`,
  );
  expect(await claims()).toEqual([]);
  await pg.exec(
    `update events set started_at=now()-interval '46 minutes',end_range=380,ended_at=now() where id='${id}'`,
  );
  expect(await claims()).toEqual([]);
  await pg.exec(
    `update events set end_range=null,ended_at=null where id='${id}'; update drive_push_devices set enabled=false`,
  );
  expect(await claims()).toEqual([]);
  await pg.exec(
    `update drive_push_devices set enabled=true,expiration_time=now()-interval '1 minute'`,
  );
  expect(await claims()).toEqual([]);
});
it("keeps current-device registration independent under one shared login", async () => {
  const d = await register("danielle"),
    m = await register("maya");
  expect((await register("danielle")).id).toBe(d.id); // same endpoint cannot duplicate
  await pg.query("select drive_push_device('disable',null,$1::jsonb)", [
    JSON.stringify(subscription("danielle")),
  ]);
  expect(
    (
      await pg.query<{ enabled: boolean }>(
        "select enabled from drive_push_devices where id=$1",
        [m.id],
      )
    ).rows[0].enabled,
  ).toBe(true);
  await register("maya", "danielle", d.id);
  expect(
    (await pg.query("select * from drive_push_devices")).rows,
  ).toHaveLength(2);
});
it("claims remain unique across overlapping checks and endpoint rotation", async () => {
  const d = await register("danielle");
  await event();
  const before = (
    await pg.query("select to_jsonb(e) d from events e order by id")
  ).rows;
  const results = await Promise.all([claims(), claims()]);
  expect(results.flat()).toHaveLength(1);
  await register("danielle", "replacement", d.id);
  expect(await claims()).toEqual([]);
  expect(
    (await pg.query("select to_jsonb(e) d from events e order by id")).rows,
  ).toEqual(before);
});
it("rechecks active state and preserves claim when existing save RPC replaces event", async () => {
  await register("danielle");
  const id = await event();
  const [claim] = await claims();
  expect(
    (await pg.query("select * from prepare_drive_reminder($1,45)", [claim.id]))
      .rows,
  ).toHaveLength(1);
  const old = (
    await pg.query<Record<string, unknown>>(
      "select * from events where id=$1",
      [id],
    )
  ).rows[0];
  await pg.query("select mutate_household('save_event',$1::jsonb)", [
    JSON.stringify({
      ...old,
      end_range: 380,
      ended_at: new Date().toISOString(),
    }),
  ]);
  expect(
    (await pg.query("select * from prepare_drive_reminder($1,45)", [claim.id]))
      .rows,
  ).toHaveLength(0);
  expect(
    (await pg.query("select * from drive_reminder_deliveries")).rows,
  ).toHaveLength(1);
});
it("limits authenticated access to own endpoint RPC and denies scheduler access", async () => {
  await register("danielle");
  await pg.exec(`set role authenticated;`);
  await expect(pg.query("select * from drive_push_devices")).rejects.toThrow(
    /permission denied/,
  );
  await expect(claims()).rejects.toThrow(/permission denied/);
  await pg.exec(`set request.jwt.claim.sub='${other}';`);
  await expect(register("maya")).rejects.toThrow(/Household/);
});
it("uses configurable threshold and rejects unsafe push destinations", () => {
  expect(thresholdMinutes()).toBe(45);
  expect(thresholdMinutes("1")).toBe(1);
  for (const n of ["0", "-1", "NaN", "1.5", "1441"])
    expect(() => thresholdMinutes(n)).toThrow();
  expect(validSubscription(subscription("valid"))).toBe(true);
  for (const endpoint of [
    "http://web.push.apple.com/x",
    "https://localhost/x",
    "https://web.push.apple.com.attacker.test/x",
    "https://web.push.apple.com:8080/x",
  ])
    expect(validEndpoint(endpoint)).toBe(false);
});
it("handles failed/uncertain delivery independently without retrying", async () => {
  const d = {
    id: "device",
    endpoint: subscription("x").endpoint,
    p256dh: "",
    auth_key: "",
  };
  const claim = { id: "claim", drive_id: "drive", device_id: d.id };
  for (const code of [201, 410, 500]) {
    const io = {
      recheck: vi.fn(async () => d),
      send: vi.fn(async () => code),
      finish: vi.fn(async () => {}),
      expire: vi.fn(async () => {}),
    };
    expect((await deliverClaim(claim, io)).status).toBe(
      code === 201 ? "accepted" : code === 410 ? "expired" : "failed",
    );
    expect(io.send).toHaveBeenCalledTimes(1);
    expect(io.expire).toHaveBeenCalledTimes(code === 410 ? 1 : 0);
  }
  const io = {
    recheck: vi.fn(async () => d),
    send: vi.fn(async () => {
      throw Error("timeout");
    }),
    finish: vi.fn(async () => {
      throw Error("unavailable");
    }),
    expire: vi.fn(async () => {}),
  };
  expect((await deliverClaim(claim, io)).status).toBe("uncertain");
  expect(io.send).toHaveBeenCalledTimes(1);
  const ended = {
    ...io,
    recheck: vi.fn(async () => null),
    send: vi.fn(async () => 201),
  };
  expect((await deliverClaim(claim, ended)).status).toBe("skipped");
  expect(ended.send).not.toHaveBeenCalled();
});
it("all authenticated device RPC responses exclude subscription secrets", async () => {
  await pg.exec("set role authenticated");
  const device = await register("danielle");
  for (const action of ["status", "test", "disable"]) {
    const result = (
      await pg.query<{ d: Record<string, unknown> }>(
        "select drive_push_device($1,null,$2::jsonb) d",
        [action, JSON.stringify(subscription("danielle"))],
      )
    ).rows[0].d;
    expect(Object.keys(result).sort()).toEqual([
      "enabled",
      "expiration_time",
      "id",
      "participant",
    ]);
    expect(result.id).toBe(device.id);
  }
  await expect(
    pg.query("select * from prepare_drive_reminder($1,45)", [randomUUID()]),
  ).rejects.toThrow(/permission denied/);
  await pg.exec("set role anon");
  await expect(claims()).rejects.toThrow(/permission denied/);
  await expect(register("maya")).rejects.toThrow(/permission denied/);
});
it("save preserves drive identity, timestamps and duplicate prevention while active", async () => {
  await register("danielle");
  const id = await event();
  const [claim] = await claims();
  const old = (
    await pg.query<Record<string, unknown>>(
      "select * from events where id=$1",
      [id],
    )
  ).rows[0];
  await pg.query("select mutate_household('save_event',$1::jsonb)", [
    JSON.stringify({ ...old, notes: "Local test edit" }),
  ]);
  const saved = (
    await pg.query<Record<string, unknown>>(
      "select * from events where id=$1",
      [id],
    )
  ).rows[0];
  expect(saved.id).toBe(old.id);
  expect(saved.created_at).toEqual(old.created_at);
  expect(saved.started_at).toEqual(old.started_at);
  expect(await claims()).toEqual([]);
  expect(
    (await pg.query("select * from prepare_drive_reminder($1,45)", [claim.id]))
      .rows,
  ).toHaveLength(1);
});
