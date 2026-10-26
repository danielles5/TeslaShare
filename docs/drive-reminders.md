# Drive Reminders — approval and deployment plan

Status: owner approved additive deployment on 2026-10-26 after the final identity/security review. The migration and Edge Function are deployed; the scheduler is installed at five-minute intervals. Automatic reminders remain disabled (`enabled=false`, `activated_at=null`) until both iPhones have received test notifications. Existing business-table counts and fingerprints matched before/after migration. No business records were changed.

Final review: the live save RPC preserves `id`, `started_at`, and `created_at` when replacing an event, so normal edits/completion cannot reset reminder identity or eligibility. Authenticated RPCs return only id/participant/enabled/expiration metadata, including the test action. Push keys are fetched only server-side after authorization. Production smoke checks reject anonymous configuration, unauthorized scheduled calls, and authenticated claim/prepare RPC access.

## Exact proposed changes

| File / operation | What it does | Production impact |
| --- | --- | --- |
| `supabase/migrations/202610260001_drive_reminders.sql` | Creates `drive_reminder_settings`, `drive_push_devices`, `drive_reminder_deliveries`, notification-only indexes, RLS, grants, and three RPC functions | Writes only new notification tables; config starts disabled with no activation cutoff. No alterations to existing tables, policies, functions, authentication or records. |
| `supabase/functions/drive-reminders/{index.ts,core.ts,deno.json,deno.lock}` and `supabase/config.toml` | New Edge Function: authenticated device registration/status/test/disable; secret-authenticated scheduled check | Reads existing drive status/start timestamp; writes only notification tables. No business mutation RPCs called. New endpoint is JWT-gateway-disabled but explicitly validates user JWTs with `auth.getUser()` or the private scheduler credential before actions. |
| Server-side secrets below | Configure Web Push signing, scheduler authentication, app URL and threshold | No existing secrets replaced; no private credentials go into the browser or GitHub. Public VAPID key alone is returned to authenticated clients. |
| `supabase/setup/drive-reminder-cron.sql` | Enables pg_cron and pg_net; adds named job `teslatrack-drive-reminders` every five minutes | Adds scheduler/network infrastructure and job logs. Calls only the new function. Does not change business tables. Existing Vault stores the scheduler secret. |
| `supabase/setup/activate-drive-reminders.sql` | Enables new notification config and sets activation cutoff once | Drives started before activation are excluded, even if still active. Separate step after phone testing; no edits to drives. |
| `components/drive-reminders.tsx`, `lib/drive-reminders.ts`, two lines in `components/app.tsx` | Adds the Settings card and per-browser subscription helpers | Only new Settings section is intentionally visible; no CSS, timer, drive flow, analytics, navigation or financial logic changes. |
| `public/sw.js` | Appends push and notification-click handlers | Existing caching handlers remain byte-for-byte unchanged. Click navigates to the installation's scope, opening normal Home with its existing active-drive interface. |
| `tsconfig.json` | Excludes Deno Edge source from Next compilation | Edge Function is checked separately with Deno. |
| Tests and this document; local secret generator; read-only fingerprint SQL | Validation/setup tooling only | No production execution by tests. |

There are deliberately no foreign keys or triggers on existing business tables. The existing event save function deletes/reinserts a row when ending/editing it; a foreign key from reminder tracking could disrupt that workflow or erase deduplication history. New RPCs use a separate notification-registration lock, not the existing drive mutation lock.

## Delivery behavior and limits

- Default threshold is centralized in `core.ts` as 45 minutes, overridden only by Edge secret `DRIVE_REMINDER_THRESHOLD_MINUTES` (integer 1–1440). Existing timer reads the same persisted `events.started_at`; timer code is untouched.
- Only real active `kind='drive'` records, with both start and creation timestamps at/after activation, qualify. Completed, historical, manual, demo, Guest and charging records do not.
- Possession chooses recipients: Danielle devices, Maya devices, or both for Shared. Starting device never determines recipients. Tesla needs no registration.
- Unique `(drive_id, device_id)` claims are committed before sending; concurrent/repeated jobs cannot obtain the same claim. Device ID survives normal endpoint rotation and disable/re-enable in that installation. Duplicate registrations for the same endpoint share one row.
- The job rechecks drive and device eligibility immediately before sending. HTTP 404/410 disables only the failed endpoint; another device still receives its attempt.
- At most one sending attempt per drive/registered device is preferred over retries. A crash, network timeout or failed status write can lose a reminder; claims are never automatically retried. “Accepted” means accepted by a push service, not delivered/read. Web Push cannot guarantee exactly-once delivery.
- Ending a drive just after the final check cannot retract an already accepted push. Five-minute push TTL limits stale delivery. OS delivery delays, Focus settings, offline phones, subscription revocation and Supabase outages/pausing can prevent notification.
- Clearing browser storage/reinstalling creates a new installation/device identity. Re-enabling that new installation during an already-overdue drive can produce another reminder for that newly registered device.
- Browser support is iOS 16.4+ installed Home Screen apps and supported desktop Web Push browsers. Supported provider hosts are Apple, Google FCM and Mozilla; no arbitrary outbound push URLs or redirects are permitted.

## Approved deployment sequence (reference; do not reapply the migration)

1. Run `supabase/setup/verify-business-data.sql` through the read-only management endpoint; save only counts/fingerprints locally. Coordinate a brief period without ordinary user edits to make before/after comparison meaningful. Fingerprints changing during normal app use are not proof of migration corruption. Financial values are derived from these unchanged source records by unchanged engine code.
2. Apply **only** `202610260001_drive_reminders.sql`, not the initial migration and not a reset/all-pending-migrations command. It runs transactionally and fails rather than replacing existing objects with these names. Review the full SQL linked above before execution.
3. Generate local secrets once: `node scripts/generate-drive-reminder-secrets.mjs`. Optionally pass a `mailto:your-address` contact argument; default subject is the public app URL. This creates mode-0600 `.env.drive-reminders` (already covered by `.gitignore`), refuses overwrite, and prints no keys. Keep VAPID keys stable after device registration. Never add `NEXT_PUBLIC_` to a private credential.
4. Deploy secrets to the approved project with `supabase secrets set --project-ref YOUR_PROJECT_REF --env-file .env.drive-reminders`, then deploy **only** `supabase functions deploy drive-reminders --project-ref YOUR_PROJECT_REF`. Function config disables gateway JWT verification; handler authorization is mandatory. Deployment imports pinned `web-push@3.6.7` and Supabase JS server-side, with Deno lockfile. No new frontend package dependency is required. Supabase supplies built-in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; do not copy these to frontend configuration.
5. In Supabase Vault add exactly `drive_reminder_project_url` (existing project URL, without trailing slash) and `drive_reminder_cron_secret` (same private value as the Edge secret). Use Dashboard Vault inputs or parameterized API SQL; do not paste secrets in chat, terminal output or tracked SQL files. pg_net temporarily stores the outbound credential in its internal request queue; privileged DB administrators can access it. The dedicated credential cannot authorize business-data mutations.
6. Apply `supabase/setup/drive-reminder-cron.sql`. Job executes every five minutes but sends no drive reminders while config is disabled. Every 30 days this is about 8,640 invocations plus registration/tests.
7. Deploy the reviewed frontend through the existing GitHub Pages workflow. Pushing main triggers deployment, so **do not push before approval**. No hosting change or new GitHub environment secret is needed. Existing `NEXT_PUBLIC_BASE_PATH=/TeslaShare` handles SW registration; notification click targets the service worker scope, including repository subpath.
8. Both iPhones register and pass Send Test Notification below while schedule is inactive. Then run **only** `activate-drive-reminders.sql`. Cutoff is the activation time; old active drives intentionally get no reminder.
9. Re-run the read-only fingerprint query and compare business records. Inspect new delivery/job logs without printing endpoints/keys. Test a new normal drive end-to-end, leaving genuine drive history intact. Live phone delivery, Apple permission and delivery after browser closure must be verified on the actual iPhones; local mocks are not proof of OS delivery.

### Exact new Edge secret configuration

| Name | Value |
| --- | --- |
| `VAPID_SUBJECT` | Public app HTTPS URL or administrator `mailto:` contact |
| `VAPID_PUBLIC_KEY` | Generated P-256 uncompressed public key, base64url |
| `VAPID_PRIVATE_KEY` | Generated P-256 private key, base64url; server only |
| `DRIVE_REMINDER_CRON_SECRET` | Generated 32 random bytes base64url; identical private Vault value |
| `DRIVE_REMINDER_APP_URL` | `https://danielles5.github.io/TeslaShare/` |
| `DRIVE_REMINDER_THRESHOLD_MINUTES` | `45` |

The `SUPABASE_ACCESS_TOKEN` in `.env.local` is local deployment authorization only, never a function/frontend setting. Do not print it or publish it.

### Changing timing / pausing

Threshold: update the Edge secret `DRIVE_REMINDER_THRESHOLD_MINUTES`; no timer/drive changes. A shorter threshold can be used against local/isolated test fixtures only; production configuration remains 45.

Check interval: change `'*/5 * * * *'` in the named `cron.schedule` call in `supabase/setup/drive-reminder-cron.sql` and re-run that call after approval. The same named job is updated. There is intentionally no unused `DRIVE_REMINDER_CHECK_INTERVAL_MINUTES` environment variable.

Pause only reminders: `update public.drive_reminder_settings set enabled=false where singleton;`. To stop scheduler invocations too: `select cron.unschedule('teslatrack-drive-reminders');`. These do not alter drive tracking or financial records. Retain notification delivery history; deleting it would remove duplicate prevention. Never reset/reseed business tables as rollback.

## Danielle and Maya: one-time iPhone setup

1. On iOS 16.4+, open TeslaTrack in Safari → Share → Add to Home Screen, if not installed already.
2. Open the Home Screen icon and sign in with the existing shared household account.
3. Settings → Drive Reminders → choose **your own name** under This Device Belongs To.
4. Tap **Enable Notifications**, then Allow in Apple's permission prompt. Permission is never requested automatically.
5. Tap **Send Test Notification**. Wait for the notification and tap it to confirm TeslaTrack opens Home. Test requests are limited to once per minute per registered device.
6. Repeat separately on the other iPhone, choosing the other name. Settings resolve only the current browser-generated subscription; changing/disabling one installation does not update the other.
7. Leave the Tesla browser unregistered. Drives started there still route using their stored possession selection.

## Local verification results

- 69 unit/database/service-worker tests pass, including real migration/RPC execution against local PGlite.
- Existing 21 browser regressions pass; the two new reminder UI tests pass after correcting their test selector.
- Next.js production static build passes.
- Approved notification-only infrastructure deployed; business records unchanged; automatic reminders disabled.

Additional review files: `tests/drive-reminders.test.ts`, `tests/reminder-worker.test.ts`, `e2e/reminders.spec.ts`, `scripts/generate-drive-reminder-secrets.mjs`, `supabase/setup/verify-business-data.sql`, and the README link.

## Verification and remaining limits

Local tests exercise real PostgreSQL migration/RPCs in PGlite, unchanged historical records, routing, timing exclusions, repeated/concurrent claims, device isolation, auth restrictions, end-drive compatibility, push failures, Settings interactions and existing regressions. Deno validates the Edge Function separately; production build validates static export.

Production Edge configuration and scheduler-handler authorization have been verified. Actual iPhone push acceptance/delivery, closed-app delivery and notification tap behavior still require the two phone tests before activation. Local mocks are not proof of OS delivery.

No paid provider or AI API is introduced. Supabase's published free allocation includes 500,000 Edge invocations/month; this job's ~8,640 is a small part of it, but other app usage, database/job-log growth, egress, current account limits and future plan changes still apply. Free projects may pause after low activity; this is not a guaranteed always-on service. No plan upgrade is part of this proposal.

Sources: [scheduled Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions), [Edge invocation usage](https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations), [runtime limits](https://supabase.com/docs/guides/functions/limits), [free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [iOS Web Push](https://webkit.org/blog/13878/).
