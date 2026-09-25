import { createClient } from "@supabase/supabase-js";
import { demoData } from "../lib/demo.ts";
const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SEED_EMAIL",
  "SEED_PASSWORD",
];
for (const key of required)
  if (!process.env[key]) throw new Error(`Missing ${key}`);
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
const auth = await db.auth.signInWithPassword({
  email: process.env.SEED_EMAIL!,
  password: process.env.SEED_PASSWORD!,
});
if (auth.error) throw auth.error;
const init = await db.rpc("household_snapshot");
if (init.error) throw init.error;
const result = await db.rpc("mutate_household", {
  action: "load_demo",
  payload: demoData(),
});
if (result.error) throw result.error;
console.log("Demo data loaded idempotently for the authenticated household.");
await db.auth.signOut();
