# Tesla Share

A private, mobile-first PWA for Danielle and Maya to share Tesla charging costs using **displayed remaining battery range**, not odometer distance. Next.js App Router, React, TypeScript, Tailwind CSS, Supabase Auth/Postgres, and static export to GitHub Pages.

## Run locally

Use Node.js 22.16 or newer (Node 22 LTS recommended).

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. Without Supabase configuration, the app offers an explicitly **read-only** demo. It does not pretend to persist entries. The reference recording is `videoRef.mp4`.

## Supabase setup

1. Create a Supabase project.
2. In **Authentication → Sign In / Providers**, under **User Signups**, turn off **Allow new users to sign up** and save. This is a private household app; there is no registration UI.
3. In **Authentication → Users → Add user → Create new user**, enter the shared account email and password and enable **Auto Confirm User**. Both phones use that account. Do not create a separate Maya account.
4. Run the complete contents of [`supabase/migrations/202609230001_initial.sql`](supabase/migrations/202609230001_initial.sql) in the SQL Editor on a fresh project. Alternatively, link the Supabase CLI to your project and run `supabase db push`.
5. In project settings, copy the project URL and **publishable key or legacy anon key** into `.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-public-publishable-or-anon-key
NEXT_PUBLIC_BASE_PATH=
```

6. Restart the dev server after changing environment variables. Sign in. The first authenticated snapshot creates the owner's household idempotently.
7. Set the Supabase Auth Site URL to your eventual Pages URL. Password login does not depend on an auth callback route.

Never put a service-role/secret key into a `NEXT_PUBLIC_` variable. The public key is intentionally present in the browser bundle; RLS and authenticated RPC ownership checks protect records. No Supabase server secret is required.

## Architecture and accounting

- `app/`: static Next.js shell, mobile styling, self-hosted Nunito Sans.
- `components/`: Home/active sessions, reusable accessible bottom sheets, forms, Dashboard, History, Settings, and auth.
- `lib/db.ts`: authenticated Supabase access. All writes use one atomic RPC; snapshots load sources consistently. Mutations serialize per household, use optimistic revisions, and accept retry IDs to avoid duplicate submissions after ambiguous network failures.
- `lib/engine.ts`: pure `rebuildDerivedState` used after every fresh snapshot. It derives signed usage allocations, chronological settlement periods, exact-agora financial responsibility, payments, and running balances. No mutable totals, stored chart percentages, or stale materialized accounting rows.
- `lib/demo.ts`: realistic source events, including Shared drives, parked loss, August partial/full charging, September 52/48 responsibility, a repayment, and an open period.
- `supabase/migrations/`: normalized households, unified range events, repayments, retry receipts, RLS, range timeline view, and atomic mutation/snapshot functions.

The unified `events` table represents the household's one vehicle. It deliberately combines drives and charges so one partial unique index can enforce **one active drive OR charge**, including concurrent phones. Manual estimates have null range endpoints. A `security_invoker` view exposes completed range events. Direct browser table writes are revoked; the RPC validates authenticated ownership, timestamps, overlaps, revisions, and database constraints.

Derived allocations and settlements are computed from persisted sources on each snapshot, rather than persisted as a second mutable database truth. Settlement IDs are closing normal/full charge IDs. Editing or deleting source rows always reconstructs the full timeline; nothing can leave stale allocation rows. The consistent snapshot and atomic source mutations make rebuilding deterministic and safe across devices.

### Decisions and edge cases

- Usage = start range − end range. Idle = previous end − next start, allocated to the **next** possession. Shared splits exactly in half. Credits remain signed; final billable participant totals are clamped at zero.
- Manual estimates break continuity until a tracked event establishes a new baseline. They cannot be added while an operation is active.
- Partial charges stay pending. Normal/full charges settle usage and all pending costs. A zero-usage full charge carries forward until a later full charge has billable usage, rather than inventing a 50/50 allocation.
- Responsibility is rounded with integer agora and a deterministic largest-remainder allocation. The sum always equals the total cost.
- Payer and possession are independent. Guest names remain per-entry metadata, represented as `guest:<name>` in accounting. With guests involved, Home displays each participant's net receivable/payable instead of incorrectly labeling every amount as debt between the sisters.
- Repayments are separate records. Partial and overpayments are supported; overpayment reverses the remaining position. Deleting a repayment rebuilds the balance.
- Demo and real records have **separate range and settlement timelines**. Demo transactions never create imaginary idle loss on real drives. Demo contributions remain visibly labeled in history/settlements, and demo removal targets one batch only.
- Analytics use `Asia/Jerusalem` calendar dates, with UTC timestamps in Postgres. Monthly/year/all-time analytics use source history, not the open charging-period totals. Charts compare Danielle and Maya; guest usage is listed separately. Future dates are excluded from historical analytics.
- Updates refresh after saves, on app/window focus, and every 30 seconds while visible. Stale edits fail instead of overwriting the other phone. The timer uses the persisted start timestamp.
- The service worker caches only the static app shell/assets. There is no offline entry queue or localStorage application database. Supabase Auth may persist its session token in browser storage. Database failure keeps entry sheets open and shows an error.

## Demo / seed

Use **Settings → Load Demo Data** after signing in. Repeated loads are idempotent. **Delete** removes only the known demo batch, without affecting real records. Demo charts derive from source records; June is 120/80, July 165/95, and August 105/155 range-km. August's ₪16 partial and ₪49 full charge form one ₪65 settlement. September's ₪48 obligation contributes ₪28 after its ₪20 repayment; older demo settlements also contribute to the all-time balance.

For CLI seeding, add `SEED_EMAIL` and `SEED_PASSWORD` to `.env.local` (never public variables), then:

```sh
npm run seed
```

The script authenticates as the owner and uses the same idempotent RPC as the UI. It does not need admin credentials.

## Tests and verification

```sh
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
npm audit
```

- Vitest tests cover idle signs and ownership, Shared conservation, negative credits, manual continuity, partial/full boundaries, repayments, exact rounding, guest accounting, zero-usage carry, deletion/edit rebuilds, calendar persistence, and demo isolation.
- Embedded Postgres (PGlite) executes the **actual migration**, including roles/RLS, snapshots, active-operation constraints, mutation validation, revisions, demo idempotency and cleanup, and physical source deletion. Only Supabase's `auth.users` / `auth.uid()` context is stubbed.
- Playwright uses an iPhone viewport and a controlled Supabase HTTP fixture. It covers login, persisted active drive/charge reloads, settlement/repayment, manual edits/deletion, failed saves, demo cleanup, navigation, and mobile overflow. The HTTP fixture is test-only; application code has no fake backend.
- Browser screenshots are written under `test-results/` during the mobile UI test.

The migration and browser layers can be tested without cloud credentials. To check the configured live project without exposing keys:

```sh
npm run check:connection
```

After adding the household account to `SEED_EMAIL` and `SEED_PASSWORD`, run `npm run verify:live`. It checks Auth and persistence using temporary, uniquely tagged records, verifies deletion from a fresh snapshot, and removes only those verification records. It refuses write tests when real household records already exist. Remove the temporary account credentials from `.env.local` after verification if you do not need CLI seeding.

A final two-device/iOS check still uses your actual phones: sign in on two devices, start a drive, refresh, finish it, create a charge/repayment, and confirm edits/deletions persist. Hosted Supabase Auth and an actual iOS home-screen install are not simulated by the embedded database/browser fixtures.

## GitHub Pages deployment

1. Push this project to a GitHub repository with default branch `main`.
2. In **Settings → Pages → Build and deployment**, select **GitHub Actions**.
3. Add repository **Actions variables**:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public publishable/anon key)
   - `NEXT_PUBLIC_BASE_PATH`: `/repository-name` for a project site. Use an empty value for a root `username.github.io` repository or custom root domain. No trailing slash.
4. Push to `main` or run the included **Verify and deploy GitHub Pages** workflow manually.
5. The workflow installs locked dependencies, typechecks, runs domain/database/browser tests, builds `out/`, uploads it, and deploys via Pages. PRs run verification/build but do not deploy.
6. Update Supabase's Site URL to the deployed URL. Sign in and use Safari **Share → Add to Home Screen** on each phone.

Next is configured with `output: 'export'`. There are no API routes, server actions, SSR, paid APIs, location tracking, or Tesla APIs. Manifest and worker URLs respect the configured repository base path; icons and start URL resolve relative to the manifest.

For a manual production check:

```sh
npm run build
python3 -m http.server 8080 --directory out
```

If building with a project base path, serve `out/` beneath that same path (or build with an empty base path for this local check).

## Operational limits

This repository does not provision or deploy a Supabase project or GitHub repository automatically. Configure the project and public environment variables before real use. Account/password recovery is managed by the household owner through Supabase; the app has no public registration or user management. Historical records are fully loaded and rebuilt in memory, appropriate for this tiny household dataset. There is no full offline data entry and no automated Tesla integration.

## Reference documentation

- [Next.js static exports](https://nextjs.org/docs/app/guides/static-exports)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase sign-in and signup configuration](https://supabase.com/docs/guides/auth/general-configuration)
