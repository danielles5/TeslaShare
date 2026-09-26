import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

for (const [width, height] of [
  [390, 844],
  [430, 932],
  [768, 1024],
  [1024, 1024],
  [1280, 960],
  [1440, 900],
]) {
  test(`responsive screens at ${width}×${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await page.clock.setFixedTime(new Date("2026-09-30T12:00:00Z"));
    const capture = async (screen: string) => {
      await page.evaluate(() => document.fonts.ready);
      const image = await page.screenshot({
        fullPage: true,
        animations: "disabled",
      });
      await writeFile(info.outputPath(`${screen}.png`), image);
      const baseline = process.env.RESPONSIVE_BASELINE;
      if (baseline && width <= 430) {
        await mkdir(baseline, { recursive: true });
        const path = `${baseline}/${width}-${screen}.png`;
        if (process.env.CAPTURE_BASELINE === "1") await writeFile(path, image);
        else
          expect(image, `${screen}: mobile pixels unchanged`).toMatchSnapshot(
            `${width}-${screen}.png`,
            { threshold: 0.05, maxDiffPixels: 0 },
          );
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (width >= 720) {
        const boxes = await page
          .locator(".content .card, .balance-card, .active-card")
          .evaluateAll((cards) =>
            cards.map((card) => {
              const r = card.getBoundingClientRect();
              return {
                left: r.left,
                right: r.right,
                top: r.top,
                bottom: r.bottom,
              };
            }),
          );
        for (const [i, a] of boxes.entries()) {
          expect(a.left).toBeGreaterThanOrEqual(0);
          expect(a.right).toBeLessThanOrEqual(width);
          for (const b of boxes.slice(i + 1)) {
            expect(
              a.right <= b.left ||
                b.right <= a.left ||
                a.bottom <= b.top ||
                b.bottom <= a.top,
              `${screen}: cards do not overlap`,
            ).toBe(true);
          }
        }
      }
    };
    await page.goto("/");
    await capture("signin");
    await page.getByRole("button", { name: "Explore read-only demo" }).click();
    await capture("home");
    if (width >= 768 && !process.env.CAPTURE_BASELINE) {
      expect((await page.locator(".app").boundingBox())!.width).toBeGreaterThan(
        600,
      );
    }
    for (const action of [
      "Start Drive",
      "Start Charge",
      "Add Forgotten Drive",
      "Settle Debt",
    ]) {
      await page.getByRole("button", { name: action, exact: true }).click();
      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();
      expect((await sheet.boundingBox())!.width).toBeLessThanOrEqual(520);
      await capture(action.replaceAll(" ", "-"));
      await page.getByRole("button", { name: "Close", exact: true }).click();
    }
    await page.getByRole("button", { name: "Dashboard", exact: true }).click();
    for (const tab of [
      "This Charging Period",
      "Monthly Breakdown",
      "This Year",
      "All Time",
    ]) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      if (tab === "Monthly Breakdown")
        await page
          .getByRole("button", { name: /August 2026: Danielle/ })
          .click();
      else await expect(page.locator(".donut")).toHaveCSS("width", "194px");
      await capture(tab.replaceAll(" ", "-"));
      if (width >= 1024 && tab === "Monthly Breakdown") {
        const chart = (await page
          .locator(".dashboard-month-chart")
          .boundingBox())!;
        const detail = (await page
          .locator(".dashboard-month-detail")
          .boundingBox())!;
        expect(chart.y).toBe(detail.y);
        expect(chart.x + chart.width).toBeLessThan(detail.x);
      }
      if (width >= 720 && tab !== "Monthly Breakdown") {
        const donut = (await page.locator(".donut").boundingBox())!;
        const totals = (await page.locator(".totals").boundingBox())!;
        expect(donut.x + donut.width).toBeLessThan(totals.x);
      }
    }
    await page.getByRole("button", { name: /View/ }).first().click();
    await capture("settlement");
    await page.getByRole("button", { name: "History", exact: true }).click();
    for (const tab of ["Drives", "Charges", "Settlements", "Repayments"]) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      await capture(`history-${tab}`);
    }
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await capture("settings");
    const nav = await page.locator(".bottom-nav").boundingBox();
    expect(nav!.x).toBeGreaterThanOrEqual(0);
    expect(nav!.x + nav!.width).toBeLessThanOrEqual(width);
    await expect(page.locator(".bottom-nav button")).toHaveCount(4);
  });
}
