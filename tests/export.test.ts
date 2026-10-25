import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { unzipSync, strFromU8 } from "fflate";
import { readExportData } from "../lib/export-data";
import { createExportWorkbook, exportSheets } from "../lib/export-workbook";
import { rebuildDerivedState } from "../lib/engine";
import { demoData } from "../lib/demo";
import type { Snapshot } from "../lib/types";

const fixture = (): Snapshot => ({
  household: { id: "demo", name: "Danielle & Maya" },
  ...demoData(),
});
function backend(
  source: Snapshot,
  options: {
    cap?: number;
    fail?: string;
    duplicate?: boolean;
    changeCount?: boolean;
  } = {},
) {
  const requests: { method: string; table: string; fields: string | null }[] =
    [];
  const client = createClient(
    "https://export-test.supabase.co",
    "public-test-key",
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: async (input, init) => {
          const url = new URL(String(input));
          const table = url.pathname.split("/").at(-1)!;
          requests.push({
            method: init?.method || "GET",
            table,
            fields: url.searchParams.get("select"),
          });
          expect(
            url.searchParams.get(
              table === "households" ? "id" : "household_id",
            ),
          ).toBe("eq.demo");
          if (table === options.fail)
            return new Response(JSON.stringify({ message: "unavailable" }), {
              status: 403,
            });
          if (table === "households")
            return new Response(JSON.stringify(source.household), {
              headers: { "Content-Type": "application/json" },
            });
          expect(["events", "repayments"]).toContain(table);
          const rows = [...source[table as "events" | "repayments"]].sort(
            (a, b) => a.id.localeCompare(b.id),
          );
          const offset = Number(url.searchParams.get("offset"));
          const limit = Math.min(
            Number(url.searchParams.get("limit")),
            options.cap || 500,
          );
          const page = rows.slice(
            options.duplicate && offset ? 0 : offset,
            (options.duplicate && offset ? 0 : offset) + limit,
          );
          return new Response(JSON.stringify(page), {
            headers: {
              "Content-Type": "application/json",
              "Content-Range": `${offset}-${offset + page.length - 1}/${rows.length + (options.changeCount && offset ? 1 : 0)}`,
            },
          });
        },
      },
    },
  );
  return { client, requests };
}

describe("strictly read-only complete source retrieval", () => {
  it("paginates past 1,000 rows and smaller server caps without duplicates", async () => {
    const data = fixture();
    data.events = Array.from({ length: 1207 }, (_, i) => ({
      ...data.events[0],
      id: `event-${String(i).padStart(5, "0")}`,
    }));
    data.repayments = Array.from({ length: 1003 }, (_, i) => ({
      ...data.repayments[0],
      household_id: "demo",
      id: `repay-${String(i).padStart(5, "0")}`,
    }));
    const before = structuredClone(data);
    const api = backend(data, { cap: 137 });
    const result = await readExportData(api.client, data);
    expect(result.events).toHaveLength(1207);
    expect(result.repayments).toHaveLength(1003);
    expect(new Set(result.events.map((e) => e.id)).size).toBe(1207);
    expect(data).toEqual(before);
    expect(api.requests.every((r) => r.method === "GET")).toBe(true);
    expect(
      api.requests.every(
        (r) => !/token|password|owner_user_id|secret/.test(r.fields || ""),
      ),
    ).toBe(true);
  });
  it.each(["events", "repayments", "households"])(
    "rejects a failed %s query",
    async (fail) => {
      const data = fixture();
      const api = backend(data, { fail });
      await expect(readExportData(api.client, data)).rejects.toThrow();
      expect(api.requests.every((r) => r.method === "GET")).toBe(true);
    },
  );
  it.each([{ duplicate: true }, { changeCount: true }])(
    "rejects inconsistent pagination: %j",
    async (options) => {
      const data = fixture();
      await expect(
        readExportData(backend(data, { ...options, cap: 2 }).client, data),
      ).rejects.toThrow();
    },
  );
  it("refuses stale financial state instead of rebuilding or exporting a partial workbook", async () => {
    const data = fixture(),
      changed = structuredClone(data);
    changed.events[0].notes = "edited on another device";
    await expect(readExportData(backend(changed).client, data)).rejects.toThrow(
      /changed/,
    );
  });
  it("handles an existing empty household", async () => {
    const data = { household: fixture().household, events: [], repayments: [] };
    expect(await readExportData(backend(data).client, data)).toEqual(data);
  });
});

const value = (cell: unknown): unknown =>
  cell && typeof cell === "object" && "value" in cell ? cell.value : cell;
const rowValues = (row: unknown[]) => row.map(value);
describe("workbook values and XLSX structure", () => {
  it("copies authoritative finalized shares, balances, raw records and signed allocations without mutating state", async () => {
    const data = fixture();
    data.events.push({
      ...data.events[0],
      id: "guest-credit",
      is_demo: false,
      demo_batch_id: null,
      possession: "guest",
      guest_name: "Dad",
      start_range: 200,
      end_range: 203.123456789,
      started_at: "2026-10-01T10:00:00+03:00",
      ended_at: "2026-10-01T11:00:00+03:00",
      notes: '=HYPERLINK("https://example.com","literal note")',
    });
    data.events.push({
      ...data.events[0],
      id: "manual",
      kind: "manual",
      is_demo: false,
      demo_batch_id: null,
      possession: "shared",
      start_range: null,
      end_range: null,
      distance: 12.123456789,
      started_at: "2026-10-02T10:00:00Z",
      ended_at: "2026-10-02T10:00:00Z",
    });
    const derived = rebuildDerivedState(data.events, data.repayments);
    const before = structuredClone({ data, derived });
    const sheets = exportSheets(
      data,
      derived,
      new Date("2026-10-25T12:00:00Z"),
    );
    expect(sheets.map((s) => s.sheet)).toEqual([
      "Summary",
      "Drives",
      "Charges",
      "Settlements",
      "Settlement Participants",
      "Usage Allocations",
      "Repayments",
    ]);
    expect(sheets[1].data.length - 1).toBe(
      data.events.filter((e) => e.kind !== "charge").length,
    );
    expect(sheets[2].data.length - 1).toBe(
      data.events.filter((e) => e.kind === "charge").length,
    );
    expect(sheets[4].data.slice(1).map(rowValues)).toEqual(
      derived.settlements.flatMap((s) =>
        s.shares.map((p) => [
          s.id,
          p.participant,
          p.participant.startsWith("guest:")
            ? p.participant.slice(6) + " (Guest)"
            : p.participant[0].toUpperCase() + p.participant.slice(1),
          p.participant.startsWith("guest:") ? p.participant.slice(6) : null,
          p.km,
          p.percentage / 100,
          p.responsibility,
          p.paid,
          p.net,
        ]),
      ),
    );
    expect(sheets[5].data.slice(1).map((r) => value(r[6]))).toEqual(
      derived.allocations.map((a) => a.km),
    );
    expect(
      sheets[1].data.find((r) => value(r[0]) === "manual")?.[11],
    ).toMatchObject({ value: 12.123456789, type: Number });
    const summary = new Map(
      sheets[0].data.slice(1).map((r) => [value(r[0]), value(r[1])]),
    );
    expect(summary.get("Danielle signed balance")).toBe(
      derived.balances.danielle,
    );
    expect(summary.get("Maya finalized financial responsibility")).toBe(
      derived.settlements
        .flatMap((s) => s.shares)
        .filter((s) => s.participant === "maya")
        .reduce((sum, s) => sum + s.responsibility, 0),
    );
    const { blob, filename } = await createExportWorkbook(
      data,
      derived,
      new Date("2026-10-25T23:30:00Z"),
    );
    expect(filename).toBe("TeslaTrack_Export_2026-10-26.xlsx");
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const workbook = strFromU8(files["xl/workbook.xml"]);
    for (const s of sheets) expect(workbook).toContain(`name="${s.sheet}"`);
    for (let i = 1; i <= 7; i++) {
      const xml = strFromU8(files[`xl/worksheets/sheet${i}.xml`]);
      expect(xml).toContain('state="frozen"');
      expect(xml).toContain('ySplit="1"');
      expect(xml).toContain('<autoFilter ref="A1:');
      expect(xml).not.toMatch(/<f[ >]/);
    }
    const styles = strFromU8(files["xl/styles.xml"]);
    expect(styles).toContain("₪");
    expect(styles).toContain("0.00%");
    expect(styles).toContain("yyyy-mm-dd");
    expect(styles).toMatch(/<b[ /]/);
    expect(strFromU8(files["xl/worksheets/sheet2.xml"])).toContain(
      String(12.123456789),
    );
    expect({ data, derived }).toEqual(before);
  });
  it("produces all seven readable header-only sheets for zero records", async () => {
    const data: Snapshot = {
      household: fixture().household,
      events: [],
      repayments: [],
    };
    const derived = rebuildDerivedState([]);
    const sheets = exportSheets(data, derived);
    expect(sheets.slice(1).every((s) => s.data.length === 1)).toBe(true);
    const { blob } = await createExportWorkbook(data, derived);
    expect(blob.size).toBeGreaterThan(1000);
  });
});
