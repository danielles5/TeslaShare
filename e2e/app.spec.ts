import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { demoData } from "../lib/demo";
import type { Snapshot, RangeEvent } from "../lib/types";
async function backend(page: Page, initial?: Snapshot) {
  let state: Snapshot = initial || {
    household: { id: "household", name: "Danielle & Maya" },
    events: [],
    repayments: [],
  };
  let fail = false;
  await page.route("https://teslashare-test.supabase.co/**", async (route) => {
    const url = new URL(route.request().url());
    const body = route.request().postDataJSON();
    const user = {
      id: "owner",
      aud: "authenticated",
      role: "authenticated",
      email: "sisters@example.com",
      created_at: new Date().toISOString(),
      app_metadata: {},
      user_metadata: {},
    };
    if (url.pathname.includes("/auth/"))
      return route.fulfill({
        json: url.pathname.includes("token")
          ? {
              access_token:
                "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvd25lciIsImV4cCI6NDEwMjQ0NDgwMH0.signature",
              refresh_token: "refresh",
              token_type: "bearer",
              expires_in: 3600,
              user,
            }
          : user,
      });
    if (fail)
      return route.fulfill({
        status: 503,
        json: { message: "Database unreachable" },
      });
    if (url.pathname.endsWith("mutate_household")) {
      const { action, payload: p } = body;
      if (action === "save_event") {
        const old = state.events.find((e) => e.id === p.id);
        if (!old && !p.ended_at && state.events.some((e) => !e.ended_at))
          return route.fulfill({
            status: 400,
            json: { message: "An operation is already active" },
          });
        const saved = {
          ...p,
          id: p.id || randomUUID(),
          household_id: "household",
          is_demo: old?.is_demo || false,
          demo_batch_id: old?.demo_batch_id || null,
          revision: (old?.revision || 0) + 1,
        } as RangeEvent;
        state = {
          ...state,
          events: [...state.events.filter((e) => e.id !== p.id), saved],
        };
      }
      if (action === "delete_event")
        state = { ...state, events: state.events.filter((e) => e.id !== p.id) };
      if (action === "repay")
        state = {
          ...state,
          repayments: [
            ...state.repayments,
            {
              ...p,
              id: randomUUID(),
              household_id: "household",
              occurred_at: new Date().toISOString(),
              is_demo: false,
              demo_batch_id: null,
            },
          ],
        };
      if (action === "delete_repayment")
        state = {
          ...state,
          repayments: state.repayments.filter((r) => r.id !== p.id),
        };
      if (action === "load_demo" && !state.events.some((e) => e.is_demo)) {
        const demo = demoData();
        state = {
          ...state,
          events: [...state.events, ...demo.events],
          repayments: [...state.repayments, ...demo.repayments],
        };
      }
      if (action === "delete_demo")
        state = {
          ...state,
          events: state.events.filter((e) => !e.is_demo),
          repayments: state.repayments.filter((e) => !e.is_demo),
        };
    }
    return route.fulfill({ json: state });
  });
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("sisters@example.com");
  await page.getByLabel("Password", { exact: true }).fill("password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start Drive", exact: true }),
  ).toBeVisible();
  return {
    state: () => state,
    fail: () => {
      fail = true;
    },
  };
}
async function startDrive(page: Page, person = "Maya", range = "395") {
  await page.getByRole("button", { name: "Start Drive", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: person, exact: true }).click();
  await sheet
    .getByLabel("Current displayed range", { exact: true })
    .fill(range);
  await sheet.getByRole("button", { name: "Start Drive", exact: true }).click();
  await expect(page.getByText("Drive in progress")).toBeVisible();
}
async function finishDrive(page: Page, range = "360") {
  await page.getByRole("button", { name: "End Drive", exact: true }).click();
  await page.getByLabel("End range", { exact: true }).fill(range);
  await page.getByRole("button", { name: "Save & End Drive" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
test("persisted drive → charge → settlement → partial repayment survives refresh", async ({
  page,
}) => {
  const api = await backend(page);
  await startDrive(page);
  await page.reload();
  await expect(page.getByText("Drive in progress")).toBeVisible();
  await finishDrive(page);
  await page.getByRole("button", { name: "Start Charge", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Maya", exact: true }).click();
  await sheet
    .getByLabel("Current displayed range", { exact: true })
    .fill("359");
  await expect(sheet.getByText("Parked loss 1 km → Maya +1 km")).toBeVisible();
  await sheet
    .getByRole("button", { name: "Start Charge", exact: true })
    .click();
  await page.reload();
  await expect(page.getByText("Charging in progress")).toBeVisible();
  await page.getByRole("button", { name: "End Charge", exact: true }).click();
  await page.getByLabel("Displayed range after charging").fill("400");
  await page.getByLabel("Total cost", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Save & Finish" }).click();
  await expect(
    page.getByText("Maya owes Danielle", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settle Debt", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("30");
  await page.getByRole("button", { name: "Record Repayment" }).click();
  await expect(page.getByRole("heading", { name: "₪70.00" })).toBeVisible();
  expect(api.state().events).toHaveLength(2);
  expect(api.state().repayments).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole("heading", { name: "₪70.00" })).toBeVisible();
});
test("manual Shared estimate and deleting source survive refresh", async ({
  page,
}) => {
  const api = await backend(page);
  await page.getByRole("button", { name: "Add Forgotten Drive" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Shared", exact: true })
    .click();
  await page.getByLabel("Distance driven").fill("20");
  await page.getByRole("button", { name: "Save Manual Estimate" }).click();
  await expect(page.getByText("10 km", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: "Edit drive" }).click();
  await page.getByLabel("Distance driven").fill("30");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("Used: 30 km")).toBeVisible();
  await page.getByRole("button", { name: "Edit drive" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  expect(api.state().events).toHaveLength(0);
  await page.reload();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByText("Your drives will appear here.")).toBeVisible();
});
test("failed save stays open and never shows a successful active drive", async ({
  page,
}) => {
  const api = await backend(page);
  await page.getByRole("button", { name: "Start Drive", exact: true }).click();
  await page.getByLabel("Current displayed range", { exact: true }).fill("390");
  api.fail();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Start Drive", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Database unreachable",
  );
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(api.state().events).toHaveLength(0);
});
test("demo loading is idempotent and cleanup preserves real entries", async ({
  page,
}) => {
  const api = await backend(page);
  await startDrive(page, "Danielle", "390");
  await finishDrive(page, "380");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Load Demo Data" }).click();
  const count = api.state().events.length;
  await page.getByRole("button", { name: "Load Demo Data" }).click();
  await expect(
    page.getByText("Demo data is currently loaded.", { exact: false }),
  ).toBeVisible();
  expect(api.state().events.length).toBe(count);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await page.reload();
  expect(api.state().events).toHaveLength(1);
  expect(api.state().events[0].is_demo).toBe(false);
});
test("mobile dashboard, details and accessible sheet fit the viewport", async ({
  page,
}) => {
  await backend(page, {
    household: { id: "h", name: "Danielle & Maya" },
    ...demoData(),
  });
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.getByRole("button", { name: "Monthly Breakdown" }).click();
  await page.getByRole("button", { name: /August 2026: Danielle/ }).click();
  await expect(
    page.getByRole("heading", { name: "August 2026" }),
  ).toBeVisible();
  await expect(page.getByText("105 km", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/dashboard-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /View/ }).first().click();
  await expect(
    page.getByRole("heading", { name: "Participants", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.screenshot({
    path: "test-results/home-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Start Drive", exact: true }).click();
  await page.getByLabel("Current displayed range", { exact: true }).fill("390");
  await page.screenshot({
    path: "test-results/start-drive-mobile.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("an unavailable initial snapshot never displays a false settled balance", async ({
  page,
}) => {
  const api = await backend(page);
  api.fail();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Connection unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Settled up" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Start Drive", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Retry connection" }),
  ).toBeVisible();
});
