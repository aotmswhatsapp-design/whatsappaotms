#!/usr/bin/env node
/**
 * Provisions a customer who can actually sign in at /login.
 *
 *   1. Supabase Auth account — via the Auth Admin API when a service key or the
 *      legacy JWT secret is available, otherwise by inserting into auth.users
 *      directly (bcrypt via pgcrypto, so `signInWithPassword` still verifies).
 *   2. The public.users mirror that business tables key on.
 *
 * Usage: node scripts/create-user.mjs <email> <password> ["Full Name"]
 */
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

function loadEnv() {
  const text = readFileSync(new URL("../.env", import.meta.url), "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();

/** The legacy service_role key is just a JWT minted with the project secret. */
function serviceRoleJwt(secret) {
  const now = Math.floor(Date.now() / 1000);
  const part = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${part({ alg: "HS256", typ: "JWT" })}.${part({
    iss: "supabase",
    role: "service_role",
    iat: now,
    exp: now + 600,
  })}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

async function createViaAdminApi(email, password, metadata) {
  const serviceKey =
    env.SUPABASE_SERVICE_ROLE_KEY ||
    (env.SUPABASE_JWT_SECRET ? serviceRoleJwt(env.SUPABASE_JWT_SECRET) : null);

  if (!serviceKey) return { skipped: "no service key or JWT secret" };

  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: metadata,
    }),
  });

  const body = await response.text();
  return response.ok
    ? { id: JSON.parse(body).id }
    : { failed: `${response.status} ${body.slice(0, 160)}` };
}

async function createInAuthSchema(prisma, email, password, metadata) {
  const rows = await prisma.$queryRaw`
    select id from auth.users where lower(email) = ${email} limit 1`;
  const existing = rows[0]?.id ?? null;
  const id = existing ?? randomUUID();

  if (existing) {
    // Re-running the script must reset the credential, not fail on the unique
    // email index.
    await prisma.$executeRaw`
      update auth.users set
        encrypted_password = extensions.crypt(${password}, extensions.gen_salt('bf', 10)),
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || ${JSON.stringify(metadata)}::jsonb,
        updated_at = now()
      where id = ${id}::uuid`;
    return { id, updated: true };
  }

  await prisma.$executeRaw`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000'::uuid, ${id}::uuid,
      'authenticated', 'authenticated', ${email},
      extensions.crypt(${password}, extensions.gen_salt('bf', 10)),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      ${JSON.stringify(metadata)}::jsonb,
      now(), now(), '', '', '', ''
    )`;

  // GoTrue keys email sign-ins off this row as well as auth.users.
  await prisma.$executeRaw`
    insert into auth.identities (
      user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      ${id}::uuid, ${id},
      ${JSON.stringify({ sub: id, email, email_verified: true })}::jsonb,
      'email', now(), now(), now()
    )
    on conflict (provider_id, provider) do nothing`;

  return { id, updated: false };
}

async function main() {
  const [emailArg, password, nameArg] = process.argv.slice(2);
  if (!emailArg || !password) {
    console.error('Usage: node scripts/create-user.mjs <email> <password> ["Full Name"]');
    process.exit(1);
  }

  const email = emailArg.trim().toLowerCase();
  const fullName = nameArg?.trim() || null;
  const metadata = fullName ? { full_name: fullName } : {};

  const prisma = new PrismaClient();

  try {
    let auth;
    const admin = await createViaAdminApi(email, password, metadata);
    if (admin.id) {
      auth = { id: admin.id, via: "admin-api" };
    } else {
      if (admin.failed) {
        console.log(`admin API unusable (${admin.failed}); writing auth schema`);
      } else if (admin.skipped) {
        console.log(`admin API skipped (${admin.skipped}); writing auth schema`);
      }
      auth = { ...(await createInAuthSchema(prisma, email, password, metadata)), via: "sql" };
    }

    const user = await prisma.user.upsert({
      where: { id: auth.id },
      create: { id: auth.id, email, fullName },
      update: { email, ...(fullName ? { fullName } : {}) },
      select: { id: true, email: true, fullName: true, role: true },
    });

    console.log(`auth user  : ${auth.id} (${auth.via}${auth.updated ? ", password reset" : ""})`);
    console.log(`postgres   : users row ${user.id} · ${user.email} · ${user.role}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
