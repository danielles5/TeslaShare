// Local-only. Never uploads secrets or changes Supabase. Refuses to overwrite keys.
import { createECDH, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const appUrl = "https://danielles5.github.io/TeslaShare/";
const subject = process.argv[2] || appUrl;
if (!/^(mailto:|https:\/\/)/.test(subject))
  throw new Error("Use a mailto: or HTTPS VAPID contact URL");
if (/[\r\n]/.test(subject)) throw new Error("Invalid contact URL");
const pair = createECDH("prime256v1");
pair.generateKeys();
const content = [
  `VAPID_SUBJECT=${subject}`,
  `VAPID_PUBLIC_KEY=${pair.getPublicKey().toString("base64url")}`,
  `VAPID_PRIVATE_KEY=${pair.getPrivateKey().toString("base64url")}`,
  `DRIVE_REMINDER_CRON_SECRET=${randomBytes(32).toString("base64url")}`,
  `DRIVE_REMINDER_APP_URL=${appUrl}`,
  "DRIVE_REMINDER_THRESHOLD_MINUTES=45",
  "",
].join("\n");
writeFileSync(".env.drive-reminders", content, { flag: "wx", mode: 0o600 });
console.log(
  "Created ignored .env.drive-reminders with restricted file permissions. No secrets displayed or uploaded.",
);
