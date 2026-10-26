import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page, unavailable = false) {
  const requests: string[] = [];
  await page.addInitScript(() => {
    const w = window as any;
    let sub: any = null;
    w.permissionRequests = 0;
    w.Notification = {
      permission: "default",
      requestPermission: async () => {
        w.permissionRequests++;
        w.Notification.permission = "granted";
        return "granted";
      },
    };
    w.PushManager = function () {};
    Object.defineProperty(navigator, "standalone", { value: true });
    const registration = {
      scope: location.origin + "/",
      pushManager: {
        getSubscription: async () => sub,
        subscribe: async () => {
          sub = {
            endpoint: "https://web.push.apple.com/test-device",
            toJSON: () => ({
              endpoint: sub.endpoint,
              keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
            }),
            unsubscribe: async () => {
              sub = null;
              return true;
            },
          };
          return sub;
        },
      },
    };
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        getRegistration: async () => registration,
        register: async () => registration,
        ready: Promise.resolve(registration),
      },
    });
  });
  let device: any = null;
  await page.route("https://teslashare-test.supabase.co/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const user = {
      id: "owner",
      aud: "authenticated",
      role: "authenticated",
      email: "sisters@example.com",
      created_at: new Date().toISOString(),
      app_metadata: {},
      user_metadata: {},
    };
    if (path.includes("/auth/"))
      return route.fulfill({
        json: path.includes("token")
          ? {
              access_token:
                "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvd25lciIsImV4cCI6NDEwMjQ0NDgwMH0.signature",
              refresh_token: "refresh",
              expires_in: 3600,
              token_type: "bearer",
              user,
            }
          : user,
      });
    if (path.endsWith("household_snapshot"))
      return route.fulfill({
        json: {
          household: { id: "household", name: "Danielle & Maya" },
          events: [],
          repayments: [],
        },
      });
    expect(path).toBe("/functions/v1/drive-reminders");
    const b = route.request().postDataJSON();
    requests.push(b.action);
    if (unavailable)
      return route.fulfill({ status: 503, json: { error: "Unavailable" } });
    if (b.action === "config")
      return route.fulfill({
        json: { publicKey: "A".repeat(87), active: true },
      });
    if (b.action === "register")
      device = {
        id: b.deviceId,
        participant: b.participant,
        enabled: true,
        expiration_time: null,
      };
    if (b.action === "disable") device = { ...device, enabled: false };
    return route.fulfill({
      json: b.action === "test" ? { accepted: true } : { device },
    });
  });
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("sisters@example.com");
  await page.getByLabel("Password", { exact: true }).fill("password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  return requests;
}
test("device setup requests permission only on enable; test, relabel and disable", async ({
  page,
}) => {
  const calls = await setup(page);
  const card = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Drive Reminders" }) });
  await expect(card.getByText(/Permission:/)).toBeVisible();
  expect(await page.evaluate(() => (window as any).permissionRequests)).toBe(0);
  await card.getByRole("button", { name: "Danielle", exact: true }).click();
  await card
    .getByRole("button", { name: "Enable Notifications", exact: true })
    .click();
  await expect(
    card.getByText("Notifications enabled on this device.", { exact: true }),
  ).toBeVisible();
  await card.getByRole("button", { name: "Send Test Notification" }).click();
  await expect(card.getByText(/Test accepted/)).toBeVisible();
  await card.getByRole("button", { name: "Maya", exact: true }).click();
  await expect(
    card.getByText("This device's participant was updated.", { exact: true }),
  ).toBeVisible();
  await card
    .getByRole("button", { name: "Disable Notifications on This Device" })
    .click();
  await expect(
    card.getByText("Notifications disabled on this device only.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(calls.filter((c) => c === "register")).toHaveLength(2);
  expect(await page.evaluate(() => (window as any).permissionRequests)).toBe(1);
});
test("unavailable reminder infrastructure leaves normal app usable", async ({
  page,
}) => {
  await setup(page, true);
  await expect(
    page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Drive Reminders" }) })
      .getByRole("alert"),
  ).toContainText("drive tracking is unaffected");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start Drive", exact: true }),
  ).toBeVisible();
});
