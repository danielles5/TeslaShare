import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Snapshot } from "./types";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const configured = Boolean(
  url && key && /^https:\/\//.test(url) && !url.includes("your-project"),
);
let client: SupabaseClient | null = null;
export function db() {
  if (!configured)
    throw new Error(
      "Configure Supabase in .env.local to connect your household.",
    );
  return (client ??= createClient(url!, key!));
}
export async function snapshot(): Promise<Snapshot> {
  const { data, error } = await db().rpc("household_snapshot");
  if (error) throw new Error(error.message);
  return data;
}
export async function mutate(
  action: string,
  payload: unknown = {},
): Promise<Snapshot> {
  const { data, error } = await db().rpc("mutate_household", {
    action,
    payload,
  });
  if (error) throw new Error(error.message);
  return data;
}
