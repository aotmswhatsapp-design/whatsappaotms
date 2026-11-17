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
const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const headers = {
  "Content-Type": "application/json",
  apikey: secret,
  Authorization: `Bearer ${secret}`,
};

const email = "avatar.probe@example.org";
const brokenAvatar = "https://lh3.googleusercontent.com/a/this-image-does-not-exist=s96-c";

const res = await fetch(`${base}/auth/v1/admin/users`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    email,
    password: "Probe1234!x",
    email_confirm: true,
    user_metadata: {
      full_name: "Rahul Verma",
      avatar_url: brokenAvatar,
      picture: brokenAvatar,
      provider_id: "probe",
    },
  }),
});

const body = await res.json();
console.log(`create -> ${res.status} ${body.id ?? body.message ?? ""}`);
console.log(`avatar_url set to a 404 URL for ${email}`);
