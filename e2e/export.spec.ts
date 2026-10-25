import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { demoData } from "../lib/demo";
import type { Snapshot } from "../lib/types";

test.use({
  defaultBrowserType:
    process.env.EXPORT_BROWSER === "webkit" ? "webkit" : "chromium",
});

async function setup(
  page: Page,
  options: { empty?: boolean; fail?: boolean; stale?: boolean } = {},
) {
  const data: Snapshot = {
    household: { id: "demo", name: "Danielle & Maya" },
    ...demoData(),
  };
  if (options.empty) {
    data.events = [];
    data.repayments = [];
  }
  const original = structuredClone(data);
  const requests: { path: string; method: string }[] = [];
  await page.route("https://teslashare-test.supabase.co/**", async (route) => {
    const url = new URL(route.request().url());
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
    if (url.pathname.endsWith("household_snapshot"))
      return route.fulfill({ json: data });
    requests.push({ path: url.pathname, method: route.request().method() });
    expect(route.request().method()).toBe("GET");
    const table = url.pathname.split("/").at(-1)!;
    if (table === "households") return route.fulfill({ json: data.household });
    if (options.fail && table === "repayments")
      return route.fulfill({ status: 403, json: { message: "Query failed" } });
    expect(["events", "repayments"]).toContain(table);
    expect(url.searchParams.get("household_id")).toBe("eq.demo");
    const records = [...data[table as "events" | "repayments"]].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const offset = Number(url.searchParams.get("offset")),
      limit = 3;
    const rows = records
      .slice(offset, offset + limit)
      .map((row) =>
        options.stale ? { ...row, notes: "Changed elsewhere" } : row,
      );
    await route.fulfill({
      json: rows,
      headers: {
        "access-control-expose-headers": "content-range",
        "content-range": `${offset}-${offset + rows.length - 1}/${records.length}`,
      },
    });
  });
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("sisters@example.com");
  await page.getByLabel("Password", { exact: true }).fill("password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  return { data, original, requests };
}
for (const width of [390, 1280]) {
  test(`read-only XLSX download at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const api = await setup(page);
    const downloaded = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export All Data (.xlsx)", exact: true })
      .click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toMatch(
      /^TeslaTrack_Export_\d{4}-\d{2}-\d{2}\.xlsx$/,
    );
    const path = info.outputPath(download.suggestedFilename());
    await download.saveAs(path);
    const files = unzipSync(await readFile(path));
    expect(
      Object.keys(files).filter((p) =>
        /^xl\/worksheets\/sheet\d+\.xml$/.test(p),
      ),
    ).toHaveLength(7);
    const drives = strFromU8(files["xl/worksheets/sheet2.xml"]);
    expect((drives.match(/<row /g) || []).length).toBe(
      api.data.events.filter((e) => e.kind !== "charge").length + 1,
    );
    await expect(
      page.getByRole("link", { name: "Download prepared file" }),
    ).toBeVisible();
    expect(api.requests.length).toBeGreaterThan(4);
    expect(api.requests.every((r) => r.method === "GET")).toBe(true);
    expect(api.data).toEqual(api.original);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
for (const options of [{ empty: true }, { fail: true }, { stale: true }]) {
  test(`export handles ${Object.keys(options)[0]}`, async ({ page }) => {
    const api = await setup(page, options);
    if (options.empty) {
      const download = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Export All Data (.xlsx)", exact: true })
        .click();
      expect((await download).suggestedFilename()).toContain(
        "TeslaTrack_Export_",
      );
    } else {
      const downloads: string[] = [];
      page.on("download", (d) => downloads.push(d.suggestedFilename()));
      await page
        .getByRole("button", { name: "Export All Data (.xlsx)", exact: true })
        .click();
      await expect(page.locator(".content").getByRole("alert")).toContainText(
        options.stale ? "changed" : "Could not read",
      );
      expect(downloads).toEqual([]);
      await expect(
        page.getByRole("link", { name: "Download prepared file" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", {
          name: "Export All Data (.xlsx)",
          exact: true,
        }),
      ).toBeEnabled();
    }
    expect(api.data).toEqual(api.original);
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Start Drive", exact: true }),
    ).toBeVisible();
  });
}

test("manual download remains available when automatic download or sharing is restricted", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (!this.download) originalClick.call(this);
    };
    Object.defineProperty(navigator, "canShare", { value: () => true });
    Object.defineProperty(navigator, "share", {
      value: async () => {
        throw new DOMException("Unavailable", "NotAllowedError");
      },
    });
  });
  await setup(page);
  await page
    .getByRole("button", { name: "Export All Data (.xlsx)", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Download prepared file" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save or share file" }).click();
  await expect(page.locator(".content").getByRole("alert")).toContainText(
    "Sharing is unavailable",
  );
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download prepared file" }).click();
  expect((await download).suggestedFilename()).toContain("TeslaTrack_Export_");
});
