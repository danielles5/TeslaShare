import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
if (!process.env.SEED_EMAIL || !process.env.SEED_PASSWORD)
  throw new Error("Set SEED_EMAIL and SEED_PASSWORD in .env.local");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:3000");
  await page.getByLabel("Email", { exact: true }).fill(process.env.SEED_EMAIL);
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.SEED_PASSWORD);
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/rpc/household_snapshot") && r.status() === 200,
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await response;
  await page
    .getByRole("button", { name: "Start Drive", exact: true })
    .waitFor();
  await page.screenshot({ path: "test-results/live-home.png" });
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.getByRole("heading", { name: "Dashboard", exact: true }).waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Production export browser verification passed: live sign-in, authenticated snapshot, mobile navigation, no overflow/runtime errors, and sign-out.",
  );
} finally {
  await browser.close();
}
