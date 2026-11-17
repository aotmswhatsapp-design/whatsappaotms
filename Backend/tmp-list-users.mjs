import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("./.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.trimStart().startsWith("#") && line.includes("="))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);

const base = env.SUPABASE_URL;
const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
console.log(`project: ${base}`);

const res = await fetch(`${base}/auth/v1/admin/users?per_page=200`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});

if (!res.ok) {
  console.log(`list failed ${res.status}`);
  process.exit(1);
}

const { users = [] } = await res.json();
console.log(`accounts: ${users.length}`);

for (const u of users) {
  const meta = u.user_metadata ?? {};
  const keys = Object.keys(meta);
  const provider = (u.app_metadata?.providers ?? [u.app_metadata?.provider]).join("+");
  console.log(
    [
      `- email=${u.email}`,
      `provider=${provider}`,
      `confirmed=${u.email_confirmed_at ? "yes" : "NO"}`,
      `full_name=${typeof meta.full_name === "string" ? "yes" : "no"}`,
      `avatar_url=${typeof meta.avatar_url === "string" ? "yes" : "no"}`,
      `picture=${typeof meta.picture === "string" ? "yes" : "no"}`,
      `meta_keys=[${keys.join(",")}]`,
    ].join(" "),
  );
}
