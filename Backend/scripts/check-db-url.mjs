#!/usr/bin/env node

/**
 * Validates SUPABASE_POSTGRES_URL before you paste it into a hosting dashboard.
 *
 * Prisma rejects a malformed URL at boot with P1013 ("invalid domain
 * character"), which costs a full deploy cycle to discover. This script
 * reproduces that parse locally and also explains the two failure modes that
 * follow it: a placeholder left in the string, and Supabase's IPv6-only direct
 * host (P1001 on Render).
 *
 * Output is deliberately ASCII so it reads the same in any Windows console.
 *
 * Usage:
 *   node scripts/check-db-url.mjs "postgresql://..."
 *   npm run check:db              # reads Backend/.env
 *   npm run check:db -- --connect # also opens a TCP socket
 */

import { promises as dns } from "node:dns";
import { readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(HERE, "..", ".env");

/** Characters a domain label may contain. Anything else fails Prisma's parser. */
const DOMAIN = /^[a-z0-9.-]+$/i;
/** Every character that may appear raw inside a URL password. */
const PASSWORD_SAFE = /^[A-Za-z0-9\-._~!$&'()*+,;=%]*$/;
const PLACEHOLDER = /<[^>]*>/;

const DIRECT_HOST = /^db\.[a-z0-9]+\.supabase\.co$/i;
const POOLER_HOST = /\.pooler\.supabase\.com$/i;

const ok = (message) => console.log(`  [ok] ${message}`);
const warn = (message) => console.log(`  [!]  ${message}`);
const bad = (message) => console.log(`  [x]  ${message}`);

/** Minimal .env reader so this runs without loading the whole Nest config. */
function fromEnvFile() {
  let text;
  try {
    text = readFileSync(ENV_PATH, "utf8");
  } catch {
    return undefined;
  }

  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*SUPABASE_POSTGRES_URL\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    const value = match[1].trim();
    // .env values are often wrapped in quotes; the quotes are not part of it.
    return value.replace(/^(['"])(.*)\1$/, "$2");
  }

  return undefined;
}

/** Splits the userinfo the way a WHATWG parser does, on the LAST '@'. */
function credentials(raw) {
  const afterScheme = raw.slice(raw.indexOf("://") + 3);
  const at = afterScheme.lastIndexOf("@");
  if (at === -1) return { user: "", pass: "" };

  const userinfo = afterScheme.slice(0, at);
  const colon = userinfo.indexOf(":");
  if (colon === -1) return { user: userinfo, pass: "" };

  return { user: userinfo.slice(0, colon), pass: userinfo.slice(colon + 1) };
}

function probe(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(6_000);
    socket.once("connect", () => done({ ok: true }));
    socket.once("timeout", () => done({ ok: false, reason: "timed out after 6s" }));
    socket.once("error", (error) => done({ ok: false, reason: error.code ?? error.message }));
  });
}

async function main() {
  // Flags and the URL can arrive in either order once npm has forwarded them.
  const args = process.argv.slice(2);
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const raw = positional[0]?.trim() || fromEnvFile();
  const connect = args.includes("--connect");

  if (!raw) {
    console.error("No connection string given and SUPABASE_POSTGRES_URL is not in .env.");
    process.exit(2);
  }

  console.log("\nChecking the connection string\n");
  let fatal = false;

  // 1. Whitespace is invisible in a dashboard field and fatal to the parser.
  if (raw !== raw.trim()) {
    bad("Leading or trailing whitespace - the dashboard field kept it.");
    fatal = true;
  } else {
    ok("No stray whitespace");
  }

  // 2. A leftover <region> / <password> is the usual cause of P1013.
  const placeholder = PLACEHOLDER.exec(raw);
  if (placeholder) {
    bad(`Leftover placeholder ${placeholder[0]} - replace it with the real value.`);
    fatal = true;
  }

  // 3. Parse it exactly as Prisma will.
  let url;
  try {
    url = new URL(raw);
  } catch (error) {
    bad(`Unparseable: ${error.message}`);
    console.error("\nFix the string before deploying.\n");
    process.exit(1);
  }

  if (!DOMAIN.test(url.hostname)) {
    bad(`Hostname "${url.hostname}" contains a character that is illegal in a domain.`);
    fatal = true;
  } else {
    ok(`Hostname is legal: ${url.hostname}`);
  }

  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    bad(`Scheme must be postgresql://, found ${url.protocol}`);
    fatal = true;
  }

  // 4. Credentials, decoded the way the parser decodes them.
  const { user, pass } = credentials(raw);
  if (!user) warn("No username - pooler URLs need postgres.<project-ref>.");
  if (!PASSWORD_SAFE.test(pass)) {
    const offender = [...new Set(pass.match(/[^A-Za-z0-9\-._~!$&'()*+,;=%]/g) ?? [])];
    bad(
      `Password contains unescaped ${offender.map((c) => `"${c}"`).join(", ")} - ` +
        "percent-encode it (@ becomes %40, # becomes %23).",
    );
    fatal = true;
  } else {
    ok(`Credentials parse; password is ${pass.length} chars and URL-safe`);
  }

  if (url.port === "" || url.port === "5432" || url.port === "6543") {
    ok(`Port ${url.port || "5432 (default)"}`);
  } else {
    warn(`Port ${url.port} is not a Supabase pooler port (5432 or 6543).`);
  }

  // 5. The two hosts behave very differently from a cloud host.
  if (POOLER_HOST.test(url.hostname)) {
    ok("Using the Supavisor pooler - IPv4-reachable, correct for Render.");
    if (!user.startsWith("postgres.")) {
      warn(`Pooler username is "${user}"; it must be postgres.<project-ref>.`);
    }
    if (url.port === "6543" && url.searchParams.get("pgbouncer") !== "true") {
      warn("Transaction pooler (6543) needs ?pgbouncer=true, or use session mode on 5432.");
    }
  } else if (DIRECT_HOST.test(url.hostname)) {
    bad("Using the direct Supabase host - IPv6-only, so Render cannot reach it (P1001).");
    warn("Use the Supabase dashboard's Session pooler string instead.");
    fatal = true;
  }

  // 6. Query records directly: getaddrinfo (dns.lookup) hides an IPv6-only
  //    host behind ENOTFOUND on a machine without IPv6, which is the exact
  //    situation this check exists to reveal.
  const [v4, v6] = await Promise.all([
    dns.resolve4(url.hostname).catch((error) => error.code ?? "ERR"),
    dns.resolve6(url.hostname).catch((error) => error.code ?? "ERR"),
  ]);

  const a = Array.isArray(v4) ? v4 : [];
  const aaaa = Array.isArray(v6) ? v6 : [];

  if (a.length > 0) {
    ok(`Resolves over IPv4 (${a.length} A record${a.length === 1 ? "" : "s"}) - reachable from Render`);
  } else if (aaaa.length > 0) {
    bad(`Resolves to IPv6 only (${aaaa.length} AAAA, no A) - Render has no IPv6 egress.`);
    fatal = true;
  } else {
    bad(`No A or AAAA record for ${url.hostname} (${v4}, ${v6}).`);
    warn("The hostname is wrong - check the region in the pooler host.");
    fatal = true;
  }

  // 7. Optional: prove a socket actually opens from this machine.
  if (connect && !fatal) {
    const port = Number(url.port || 5432);
    const result = await probe(url.hostname, port);

    if (result.ok) {
      ok(`TCP ${url.hostname}:${port} is reachable`);
    } else {
      warn(`TCP ${url.hostname}:${port} failed (${result.reason}) - check the password/plan.`);
    }
  }

  console.log("");
  if (fatal) {
    console.log("Result: fix the problems above before pasting this into Render.\n");
    process.exit(1);
  }

  console.log("Result: string looks deployable.\n");
}

await main();
