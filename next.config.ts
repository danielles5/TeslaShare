import type { NextConfig } from "next";
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
let isSecret = publicKey.startsWith("sb_secret_");
if (publicKey.split(".").length === 3) {
  try {
    isSecret ||=
      JSON.parse(Buffer.from(publicKey.split(".")[1], "base64url").toString())
        .role === "service_role";
  } catch {
    /* Publishable keys need not be JWTs. */
  }
}
if (isSecret)
  throw new Error(
    "Use a Supabase publishable/anon key, never a service-role/secret key in NEXT_PUBLIC_SUPABASE_ANON_KEY.",
  );
const config: NextConfig = {
  output: "export",
  devIndicators: false,
  trailingSlash: true,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  images: { unoptimized: true },
};
export default config;
