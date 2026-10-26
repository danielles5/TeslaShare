import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
function worker() {
  const handlers: Record<string, (e: any) => void> = {};
  const registration = {
    scope: "https://example.test/TeslaShare/",
    getNotifications: vi.fn(async () => []),
    showNotification: vi.fn(async () => {}),
  };
  const clients = {
    matchAll: vi.fn(async () => [] as any[]),
    openWindow: vi.fn(async () => {}),
  };
  runInNewContext(readFileSync("public/sw.js", "utf8"), {
    URL,
    self: {
      registration,
      clients,
      addEventListener: (name: string, fn: any) => {
        handlers[name] = fn;
      },
    },
  });
  const invoke = async (name: string, event: any) => {
    let pending;
    handlers[name]({
      ...event,
      waitUntil: (p: Promise<unknown>) => {
        pending = p;
      },
    });
    await pending;
  };
  return { registration, clients, invoke };
}
it("push uses the existing logo and stable tag inside repository scope", async () => {
  const w = worker();
  await w.invoke("push", {
    data: {
      json: () => ({
        title: "TeslaTrack",
        body: "Did you finish your drive? 🚗",
        driveId: "10000000-0000-4000-8000-000000000001",
      }),
    },
  });
  expect(w.registration.showNotification).toHaveBeenCalledWith(
    "TeslaTrack",
    expect.objectContaining({
      icon: "https://example.test/TeslaShare/teslasharelogo.png",
      tag: "teslatrack-drive-10000000-0000-4000-8000-000000000001",
      renotify: false,
    }),
  );
});
it("notification click opens the installed scope, never a payload destination", async () => {
  const w = worker();
  await w.invoke("notificationclick", {
    notification: { close: vi.fn(), data: { url: "https://attacker.test" } },
  });
  expect(w.clients.openWindow).toHaveBeenCalledWith(
    "https://example.test/TeslaShare/",
  );
  const client = {
    url: "https://example.test/TeslaShare/",
    navigate: vi.fn(async () => ({ focus: vi.fn(async () => {}) })),
  };
  w.clients.matchAll.mockResolvedValue([client]);
  await w.invoke("notificationclick", { notification: { close: vi.fn() } });
  expect(client.navigate).toHaveBeenCalledWith(
    "https://example.test/TeslaShare/",
  );
});
