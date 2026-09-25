const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error("Missing Supabase public configuration");
const settings = await fetch(`${url}/auth/v1/settings`, {
  headers: { apikey: key },
});
const info = await settings.json();
console.log(
  JSON.stringify(
    { authStatus: settings.status, publicSignupDisabled: info.disable_signup },
    null,
    2,
  ),
);
const schema = await fetch(`${url}/rest/v1/range_timeline?select=id&limit=1`, {
  headers: { apikey: key },
});
const result = await schema.json();
console.log(
  JSON.stringify(
    {
      schemaStatus: schema.status,
      code: result.code || null,
      message: result.message || "Accessible",
    },
    null,
    2,
  ),
);
