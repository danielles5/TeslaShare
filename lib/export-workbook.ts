import writeXlsx, { type Cell, type Sheet } from "write-excel-file/universal";
import {
  getCellAddress,
  getOrderOfSiblings,
  insertElementMarkupAccordingToOrderOfSiblings,
} from "write-excel-file/utility";
import { analytics, type rebuildDerivedState } from "./engine";
import { calendarKey, name } from "./format";
import type { Snapshot } from "./types";

type Derived = ReturnType<typeof rebuildDerivedState>;
const currency = '"₪"#,##0.00;[Red]-"₪"#,##0.00';
const number = (
  value: number | null | undefined,
  format = "0.###############",
): Cell => (value == null ? null : { value, type: Number, format });
const cash = (value: number | null | undefined) => number(value, currency);
const date = (value: string | null): Cell =>
  value
    ? { value: new Date(value), type: Date, format: "yyyy-mm-dd hh:mm:ss.000" }
    : null;
const text = (value: string | null | undefined): Cell =>
  value == null ? null : { value, type: String };
const person = (value: string | null, guest: string | null = null) =>
  value ? name(value === "guest" ? `guest:${guest || "Guest"}` : value) : null;

export function exportSheets(
  data: Snapshot,
  derived: Derived,
  now = new Date(),
): Sheet<Blob>[] {
  const sheets: Sheet<Blob>[] = [];
  const sheet = (title: string, headers: string[], rows: Cell[][]) => {
    if (rows.length > 1048575)
      throw new Error(
        "This export exceeds the spreadsheet row limit. No file was created.",
      );
    sheets.push({
      sheet: title,
      stickyRowsCount: 1,
      columns: headers.map((h) => ({
        width: /Notes|Meaning/.test(h)
          ? 55
          : /ID|Original/.test(h)
            ? 38
            : /date|time|UTC/.test(h)
              ? 25
              : 24,
      })),
      data: [
        headers.map((value) => ({ value, type: String, fontWeight: "bold" })),
        ...rows,
      ],
    });
  };
  const stats = analytics(data.events, derived.allocations, "all", now);
  const sharedIds = new Set(
    data.events.filter((e) => e.possession === "shared").map((e) => e.id),
  );
  const shares = derived.settlements.flatMap((s) => s.shares);
  const positions = Object.entries(derived.balances).filter(
    ([, v]) => Math.abs(v) >= 0.005,
  );
  const onlySisters = positions.every(
    ([p]) => p === "danielle" || p === "maya",
  );
  const summary: Cell[][] = [
    [
      "Export date/time (UTC)",
      date(now.toISOString()),
      "All spreadsheet dates are UTC; original timestamps are preserved in adjacent text columns.",
    ],
    ["Original export timestamp", text(now.toISOString()), "ISO 8601"],
    ["Household", text(data.household.name), text(data.household.id)],
    [
      "Total drive records",
      number(data.events.filter((e) => e.kind !== "charge").length),
      "Includes manual estimates and active records; active usage remains blank.",
    ],
    [
      "Completed drives",
      number(stats.drives),
      "Existing all-time analytics; through export time.",
    ],
    [
      "Total range-km usage",
      number(Object.values(stats.usage).reduce((a, b) => a + b, 0)),
      "Existing all-time billable usage, including Guests. Signed allocations are in Usage Allocations.",
    ],
    [
      "Danielle total usage (km)",
      number(stats.usage.danielle),
      "Existing all-time analytics",
    ],
    [
      "Maya total usage (km)",
      number(stats.usage.maya),
      "Existing all-time analytics",
    ],
    [
      "Shared contribution (km)",
      number(
        derived.allocations
          .filter((a) => sharedIds.has(a.source_id))
          .reduce((s, a) => s + Math.max(0, a.km), 0),
      ),
      "Positive Shared drive/manual/idle allocations summed once, before the participant split; same display convention as Dashboard.",
    ],
    [
      "Total charging spend",
      cash(stats.spend),
      "Existing all-time analytics; completed charges through export time.",
    ],
    [
      "Total paid by Danielle",
      cash(stats.paid("danielle")),
      "Actual payer records, not responsibility.",
    ],
    [
      "Total paid by Maya",
      cash(stats.paid("maya")),
      "Actual payer records, not responsibility.",
    ],
    ...["danielle", "maya"].map((p) => [
      `${name(p)} finalized financial responsibility`,
      cash(
        shares
          .filter((s) => s.participant === p)
          .reduce((sum, s) => sum + s.responsibility, 0),
      ),
      "Sum of existing finalized settlement shares. Excludes the open period. Not a Dashboard proportional estimate.",
    ]),
    [
      "Total repayments",
      cash(data.repayments.reduce((s, r) => s + r.amount, 0)),
      "All recorded repayments, including marked demo records.",
    ],
    [
      "Outstanding balance",
      onlySisters ? cash(Math.abs(derived.balances.danielle || 0)) : null,
      !positions.length
        ? "Settled up"
        : onlySisters
          ? derived.balances.danielle > 0
            ? "Maya owes Danielle"
            : "Danielle owes Maya"
          : "Multiple participants: see signed balances below; no pairwise debts invented.",
    ],
    ...Object.entries(derived.balances).map(([p, v]) => [
      `${name(p)} signed balance`,
      cash(v),
      "Positive = should receive; negative = owes. Includes recorded repayments, exactly as shown in the app.",
    ]),
    [
      "Settlement source",
      "Existing in-memory finalized settlements",
      "The schema stores events and repayments, not settlement/allocation tables. Export copies the app's already-derived state; no settlements are rebuilt or saved.",
    ],
    [
      "Dashboard responsibility estimates",
      "Not included",
      "Dashboard proportional analytics are informational and are not finalized financial responsibility.",
    ],
    [
      "Demo records included",
      data.events.some((e) => e.is_demo) ||
        data.repayments.some((r) => r.is_demo),
      "Demo rows remain marked and are included exactly as in the app.",
    ],
    [
      "Source event count",
      number(data.events.length),
      "All paginated authorized source records, including active drives/charges.",
    ],
    [
      "Source repayment count",
      number(data.repayments.length),
      "All paginated authorized repayment records.",
    ],
  ];
  sheet("Summary", ["Metric", "Value", "Meaning / notes"], summary);
  sheet(
    "Drives",
    [
      "Record ID",
      "Start (UTC)",
      "End (UTC)",
      "Driver",
      "Guest name",
      "Start range (km)",
      "End range (km)",
      "Recorded usage (km)",
      "Duration (minutes)",
      "Idle consumption / credit (km)",
      "Source type",
      "Manual estimated distance (km)",
      "Notes",
      "Demo",
      "Demo batch ID",
      "Revision",
      "Original start timestamp",
      "Original end timestamp",
    ],
    data.events
      .filter((e) => e.kind !== "charge")
      .map((e) => [
        text(e.id),
        date(e.started_at),
        date(e.ended_at),
        person(e.possession, e.guest_name),
        text(e.guest_name),
        number(e.start_range),
        number(e.end_range),
        number(
          e.kind === "manual"
            ? e.distance
            : e.ended_at && e.start_range != null && e.end_range != null
              ? derived.allocations
                  .filter((a) => a.source_id === e.id && a.source === "drive")
                  .reduce((s, a) => s + a.km, 0)
              : null,
        ),
        number(e.duration_minutes),
        number(derived.idle[e.id]),
        e.kind === "manual" ? "Manual estimate" : "Tracked",
        number(e.distance),
        text(e.notes),
        e.is_demo,
        text(e.demo_batch_id),
        number(e.revision),
        text(e.started_at),
        text(e.ended_at),
      ]),
  );
  sheet(
    "Charges",
    [
      "Record ID",
      "Start (UTC)",
      "End (UTC)",
      "Charge type",
      "Start range (km)",
      "End range (km)",
      "Range added (km)",
      "Total cost (₪)",
      "Energy (kWh)",
      "Price per kWh (₪)",
      "Possession",
      "Possession guest name",
      "Actual payer",
      "Payer guest name",
      "Notes",
      "Demo",
      "Demo batch ID",
      "Revision",
      "Original start timestamp",
      "Original end timestamp",
    ],
    data.events
      .filter((e) => e.kind === "charge")
      .map((e) => [
        text(e.id),
        date(e.started_at),
        date(e.ended_at),
        e.charge_type === "normal_full"
          ? "Normal/Full"
          : e.charge_type === "partial_emergency"
            ? "Partial/Emergency"
            : null,
        number(e.start_range),
        number(e.end_range),
        number(
          e.start_range != null && e.end_range != null
            ? e.end_range - e.start_range
            : null,
        ),
        cash(e.cost),
        number(e.kwh),
        cash(e.rate),
        person(e.possession, e.guest_name),
        text(e.guest_name),
        person(e.payer, e.payer_guest_name),
        text(e.payer_guest_name),
        text(e.notes),
        e.is_demo,
        text(e.demo_batch_id),
        number(e.revision),
        text(e.started_at),
        text(e.ended_at),
      ]),
  );
  sheet(
    "Settlements",
    [
      "Settlement ID",
      "Period start (UTC)",
      "Period end (UTC)",
      "Closing charge ID",
      "Total charging cost (₪)",
      "Total billable range-km",
      "Danielle usage (km)",
      "Maya usage (km)",
      "Guest usage (km)",
      "Status",
      "Demo",
      "Original period start",
      "Original period end",
    ],
    derived.settlements.map((s) => [
      text(s.id),
      date(s.started_at),
      date(s.ended_at),
      text(s.id),
      cash(s.cost),
      number(s.shares.reduce((sum, p) => sum + p.km, 0)),
      number(s.shares.find((p) => p.participant === "danielle")?.km ?? 0),
      number(s.shares.find((p) => p.participant === "maya")?.km ?? 0),
      number(
        s.shares
          .filter((p) => p.participant.startsWith("guest:"))
          .reduce((sum, p) => sum + p.km, 0),
      ),
      "Finalized (not repayment status)",
      s.is_demo,
      text(s.started_at),
      text(s.ended_at),
    ]),
  );
  sheet(
    "Settlement Participants",
    [
      "Settlement ID",
      "Participant key",
      "Participant",
      "Guest name",
      "Billable usage (km)",
      "Usage percentage",
      "Responsibility (₪)",
      "Actually paid (₪)",
      "Net position (₪)",
    ],
    derived.settlements.flatMap((s) =>
      s.shares.map((p) => [
        text(s.id),
        text(p.participant),
        text(name(p.participant)),
        p.participant.startsWith("guest:")
          ? text(p.participant.slice(6))
          : null,
        number(p.km),
        number(p.percentage / 100, "0.00%"),
        cash(p.responsibility),
        cash(p.paid),
        cash(p.net),
      ]),
    ),
  );
  const events = new Map(data.events.map((e) => [e.id, e]));
  sheet(
    "Usage Allocations",
    [
      "Source event ID",
      "Source type",
      "Date/time (UTC)",
      "Participant key",
      "Participant",
      "Guest name",
      "Allocated range-km",
      "Demo",
      "Demo batch ID",
      "Original timestamp",
    ],
    derived.allocations.map((a) => [
      text(a.source_id),
      text(a.source),
      date(a.occurred_at),
      text(a.participant),
      text(name(a.participant)),
      a.participant.startsWith("guest:") ? text(a.participant.slice(6)) : null,
      number(a.km),
      a.is_demo,
      text(events.get(a.source_id)?.demo_batch_id),
      text(a.occurred_at),
    ]),
  );
  sheet(
    "Repayments",
    [
      "Repayment ID",
      "Date/time (UTC)",
      "Payer key",
      "Payer",
      "Recipient key",
      "Recipient",
      "Amount (₪)",
      "Notes",
      "Demo",
      "Demo batch ID",
      "Original timestamp",
    ],
    data.repayments.map((r) => [
      text(r.id),
      date(r.occurred_at),
      text(r.payer),
      text(name(r.payer)),
      text(r.recipient),
      text(name(r.recipient)),
      cash(r.amount),
      text(r.notes),
      r.is_demo,
      text(r.demo_batch_id),
      text(r.occurred_at),
    ]),
  );
  return sheets;
}

export async function createExportWorkbook(
  data: Snapshot,
  derived: Derived,
  now = new Date(),
) {
  const sheets = exportSheets(data, derived, now);
  const blob = await writeXlsx(sheets, {
    features: [
      {
        files: {
          transform: {
            "xl/worksheets/sheet{id}.xml": {
              transform(xml, _options, { sheetIndex }) {
                const sheet = sheets[sheetIndex];
                const end = getCellAddress(
                  sheet.data.length - 1,
                  sheet.data[0].length - 1,
                );
                return insertElementMarkupAccordingToOrderOfSiblings(
                  xml,
                  `<autoFilter ref="A1:${end}"/>`,
                  getOrderOfSiblings(
                    "xl/worksheets/sheet{id}.xml",
                    "worksheet",
                  )!,
                  "worksheet",
                );
              },
            },
          },
        },
      },
    ],
  }).toBlob();
  // Calendar date follows the household's existing Asia/Jerusalem convention.
  const day = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
  })
    .formatToParts(now)
    .find((part) => part.type === "day")!.value;
  return {
    blob,
    filename: `TeslaTrack_Export_${calendarKey(now.toISOString())}-${day}.xlsx`,
  };
}
