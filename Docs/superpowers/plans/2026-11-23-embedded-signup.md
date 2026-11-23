# WhatsApp Embedded Signup v4 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Meta Embedded Signup v4 as the primary way an AOTMS workspace connects a WhatsApp number, keeping the manual five-field form as a fallback.

**Architecture:** A platform Meta app (env-configured) is the front door. The browser opens Meta's dialog, receives a one-shot code plus `waba_id`/`phone_number_id`, and posts them to the API. The API exchanges the code server-side, proves the number belongs to the authorised WABA, subscribes the app to the WABA, reads the token's expiry with `debug_token`, and upserts one row per `workspaceId`. Manual connections are untouched and still verify their own signatures.

**Tech Stack:** NestJS 11 + Prisma 6 + Postgres; Next 16 App Router + React 19; Meta Graph API v23.0.

**Spec:** `Docs/superpowers/specs/2026-11-22-embedded-signup-design.md`

---

## Global Constraints

- All five Meta variables stay **optional** in the Zod schema. Missing values must turn `signup-config.enabled` false and make the ES endpoints answer `503`; the manual path must keep working.
- `META_APP_SECRET`, access tokens and verify tokens never reach the browser. The browser receives only `appId` and `configId`, both public.
- Nothing is written until code exchange, ownership check, `subscribed_apps` and `debug_token` have all succeeded.
- Never overwrite an existing connection without an explicit confirmation in the UI.
- `expires_at === 0` means never-expiring and stores `null`; a missing `expires_at` is a failure, not "never".
- Meta error `190` + `error_subcode` `463` is expiry. Any other `190` is a rejected/revoked token.
- No fake Meta responses may be presented as production proof. Real checks are labelled real; harnesses are labelled harnesses.
- Conventional commits: `feat(whatsapp): …`, `fix(whatsapp): …`, `chore(whatsapp): …`.
- PowerShell: use `;` not `&&`. Never pipe a build into another command when its exit code is needed.
- Every backend task ends with `npm run typecheck` from `Backend/`; every frontend task ends with `npx tsc --noEmit` from `frontend/`.

## Pre-flight facts (verified, do not re-derive)

| Fact | Evidence |
| --- | --- |
| `META_APP_ID` + `META_APP_SECRET` are a valid pair for app **"Academy Of Tech Masters"** | Live `GET /v23.0/{app-id}?fields=id,name` → HTTP 200, `id` matched `.env` |
| `META_ES_CONFIG_ID` is byte-identical to the leftover `CONFIGUATION_KEY` | Compared in-process, both 16 digits |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` present, 24 chars | Key listing |
| Config → app binding | **Not verifiable via API** (`client_business_login_configs` edge → 400/2500). Must be confirmed in App Dashboard → Facebook Login for Business → Configurations, or by a real dialog run |
| No Embedded Signup code in the tree | `git log -S "EMBEDDED_SIGNUP"` → `dd84b05` (add), `f38aabc` (remove) |

---

## File Map

| File | Action | Responsibility |
| --- | --- | --- |
| `Backend/src/config/env.ts` | modify | Declare four new optional variables |
| `Backend/.env.example` | modify | Document them |
| `Backend/prisma/schema.prisma` | modify | `tokenExpiresAt` |
| `Backend/prisma/migrations/0013_embedded_signup_expiry/migration.sql` | create | Add `token_expires_at` |
| `Backend/src/whatsapp/dto/embedded-signup.dto.ts` | create (restore) | Validate `code`, `wabaId`, `phoneNumberId` |
| `Backend/src/whatsapp/meta-graph.ts` | modify | `exchangeCode`, `listBusinessPhoneNumberIds`, `debugToken` |
| `Backend/src/whatsapp/whatsapp.service.ts` | modify | `signupConfig`, `connectEmbedded`, expiry payloads, `expired` blame |
| `Backend/src/whatsapp/whatsapp.controller.ts` | modify | Two endpoints |
| `Backend/src/whatsapp/whatsapp-webhook.service.ts` | modify | Platform verify token + platform signature fallback |
| `frontend/src/features/whatsapp/components/api.ts` | modify | `fetchSignupConfig`, `connectEmbeddedSignup`, `tokenExpiresAt` |
| `frontend/src/features/whatsapp/components/facebook-sdk.ts` | restore | SDK loader + dialog runner |
| `frontend/src/features/whatsapp/components/embedded-signup.tsx` | restore | The one-click card |
| `frontend/src/features/whatsapp/components/token-expiry.ts` | create | 7-day warning maths, one source of truth |
| `frontend/src/features/whatsapp/components/whatsapp-connection.tsx` | modify | Primary/secondary layout, reconnect, overwrite confirm |
| `frontend/src/features/whatsapp/components/live-panel.tsx` | modify | Expiry row, platform rows, Reconnect CTA |
| `frontend/src/features/whatsapp/components/webhook-fields.tsx` | modify | Hide the per-workspace token for ES rows |
| `frontend/src/lib/api/whatsapp-status.ts` | modify | `tokenExpiresAt` |

---

## Task 1: Environment contract

**Files:**
- Modify: `Backend/src/config/env.ts` (insert after the `META_APP_ID` block, before `CORS_ORIGINS`)
- Modify: `Backend/.env.example`

**Interfaces:**
- Produces: config keys `META_APP_SECRET`, `META_ES_CONFIG_ID`, `META_GRAPH_VERSION` (default `v23.0`), `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, all readable via `config.get<string>()`.

- [ ] **Step 1: Insert the four declarations**

```ts
  /**
   * Embedded Signup's platform app secret. It signs the OAuth code exchange and
   * every delivery from a connection created through the dialog. Optional, like
   * META_APP_ID, so a manual-only deployment still boots.
   */
  META_APP_SECRET: z
    .string()
    .min(10)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /** The "Facebook Login for Business" configuration that carries Embedded Signup. */
  META_ES_CONFIG_ID: z
    .string()
    .regex(/^\d{6,}$/, "META_ES_CONFIG_ID is a numeric configuration id")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /** Version the platform app calls: code exchange, subscribed_apps, debug_token. */
  META_GRAPH_VERSION: z
    .string()
    .regex(/^v\d{1,2}\.\d$/, "META_GRAPH_VERSION looks like v23.0")
    .default("v23.0"),
  /**
   * The token typed into the app's single Webhooks panel. With a platform app
   * Meta verifies the callback URL once for the whole deployment, so there is
   * no per-workspace token to match for signup rows.
   */
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z
    .string()
    .min(8)
    .optional()
    .or(z.literal("").transform(() => undefined)),
```

- [ ] **Step 2: Document them in `.env.example`** under the existing `META_APP_ID` block, one short comment each, values left blank.

- [ ] **Step 3: Remove the inert key from the local file** (`CONFIGUATION_KEY`), keeping `META_ES_CONFIG_ID`. Never print values.

- [ ] **Step 4: Verify** — `cd Backend; npm run typecheck`. Expected: exit 0.

- [ ] **Step 5: Commit** — `git commit -am "feat(whatsapp): declare embedded signup env contract"`

---

## Task 2: Token expiry column

**Files:**
- Modify: `Backend/prisma/schema.prisma` (`model WhatsAppAccount`, after `insightsEnabledAt`)
- Create: `Backend/prisma/migrations/0013_embedded_signup_expiry/migration.sql`

**Interfaces:**
- Produces: `WhatsAppAccount.tokenExpiresAt: Date | null`; every row created before this migration keeps `null`.

- [ ] **Step 1: Add the field**

```prisma
  /// When the stored business token lapses, as Meta reported at connect time.
  /// Null means "Meta said it never expires" or "not yet known" — the UI says
  /// nothing rather than guessing, matching how `currency` behaves.
  tokenExpiresAt     DateTime?      @map("token_expires_at")
```

- [ ] **Step 2: Write the migration by hand** (this repo numbers migrations manually):

```sql
-- Embedded Signup: remember when the business token lapses.
ALTER TABLE "whatsapp_accounts"
  ADD COLUMN "token_expires_at" TIMESTAMP(3);
```

- [ ] **Step 3: Apply and generate**

```powershell
cd Backend
npx prisma migrate deploy
npx prisma generate
npx prisma migrate status
```

Expected: `Database schema is up to date!` and migration `0013_embedded_signup_expiry` listed as applied.

- [ ] **Step 4: Record evidence** — paste the `migrate status` output into the final report.

- [ ] **Step 5: Commit** — `git commit -am "feat(whatsapp): add token_expires_at for embedded signup"`

---

## Task 3: Restore the DTO

**Files:**
- Create: `Backend/src/whatsapp/dto/embedded-signup.dto.ts`

**Interfaces:**
- Produces: `class EmbeddedSignupDto { code: string; wabaId: string; phoneNumberId: string }`

- [ ] **Step 1: Restore the exact file**

```powershell
git checkout dd84b05 -- Backend/src/whatsapp/dto/embedded-signup.dto.ts
```

- [ ] **Step 2: Confirm it parses unchanged** — `cd Backend; npm run typecheck`. Expected: exit 0. The file is self-contained (`class-transformer` + `class-validator` only).

---

## Task 4: Graph methods

**Files:**
- Modify: `Backend/src/whatsapp/meta-graph.ts`

**Interfaces:**
- Produces:
  - `exchangeCode({ version, clientId, clientSecret, code }): Promise<string>`
  - `listBusinessPhoneNumberIds({ version, businessAccountId, token }): Promise<string[]>`
  - `debugToken({ version, appId, appSecret, token }): Promise<{ isValid: boolean; expiresAt: number | null }>`
- Consumes: existing `urlOf()`, `send()`, `MetaShapeError`.

- [ ] **Step 1: Add the wire types** next to the other exported interfaces:

```ts
export interface TokenExchangeResult {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

export interface PhoneNumberList {
  data?: { id?: string }[];
}

export interface TokenDebugResult {
  data?: { is_valid?: boolean; expires_at?: number };
}
```

- [ ] **Step 2: Add the three methods** immediately before `private get<T>(`:

```ts
  /**
   * Embedded Signup, step one. The dialog hands the browser a one-shot code;
   * only a server holding the app secret can trade it. GET with credentials in
   * the query string is the only shape Meta accepts here.
   */
  async exchangeCode(input: {
    version: string;
    clientId: string;
    clientSecret: string;
    code: string;
  }): Promise<string> {
    const url = this.urlOf(input.version, ["oauth", "access_token"]);
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("client_secret", input.clientSecret);
    url.searchParams.set("code", input.code);

    const payload = await this.send<TokenExchangeResult>(url, { method: "GET" });

    if (!payload.access_token) {
      throw new MetaShapeError(
        "Meta accepted the signup code but returned no access token.",
      );
    }

    return payload.access_token;
  }

  /**
   * The numbers the WABA actually owns. The dialog tells the browser which one
   * was picked; this list is the server's proof that the account really
   * contains it, so one tenant cannot claim another's number.
   */
  async listBusinessPhoneNumberIds(input: {
    version: string;
    businessAccountId: string;
    token: string;
  }): Promise<string[]> {
    const url = this.urlOf(input.version, [
      input.businessAccountId,
      "phone_numbers",
    ]);
    url.searchParams.set("fields", "id");

    const payload = await this.send<PhoneNumberList>(url, {
      method: "GET",
      token: input.token,
    });
    const rows = Array.isArray(payload.data) ? payload.data : [];

    return rows
      .map((row) => row?.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }

  /**
   * What the token actually is. `expires_at` is epoch seconds and 0 means
   * never; a missing value is returned as null so the caller can refuse to
   * store a connection whose lifetime is unknown.
   */
  async debugToken(input: {
    version: string;
    appId: string;
    appSecret: string;
    token: string;
  }): Promise<{ isValid: boolean; expiresAt: number | null }> {
    const url = this.urlOf(input.version, ["debug_token"]);
    url.searchParams.set("input_token", input.token);
    url.searchParams.set("access_token", `${input.appId}|${input.appSecret}`);

    const payload = await this.send<TokenDebugResult>(url, { method: "GET" });
    const data = payload.data ?? {};

    return {
      isValid: data.is_valid === true,
      expiresAt: typeof data.expires_at === "number" ? data.expires_at : null,
    };
  }
```

- [ ] **Step 3: Verify** — `cd Backend; npm run typecheck`. Expected: exit 0.

---

## Task 5: `signupConfig` and `connectEmbedded`

**Files:**
- Modify: `Backend/src/whatsapp/whatsapp.service.ts`

**Interfaces:**
- Consumes: Task 4 methods, `workspaces.primaryFor()`, `SecretBox.seal()`, `generateVerifyToken()`.
- Produces: `signupConfig(): SignupConfigPayload`, `connectEmbedded(claims, dto): Promise<EmbeddedConnectResult>`.

- [ ] **Step 1: Keep the config** — change the constructor parameter from `config: ConfigService` to `private readonly config: ConfigService`, and re-add imports `BadGatewayException`, `BadRequestException`, `ServiceUnavailableException`, `MetaShapeError`, and `import type { EmbeddedSignupDto } from "./dto/embedded-signup.dto";`.

- [ ] **Step 2: Add the payload types** after `ConnectResult`:

```ts
/**
 * What the browser needs to launch Meta's dialog. `enabled` is false until the
 * operator's platform app exists in the API's environment; the screen then
 * leads with the manual path instead.
 */
export interface SignupConfigPayload {
  enabled: boolean;
  appId: string | null;
  configId: string | null;
  graphVersion: string;
}

export interface EmbeddedConnectResult {
  account: PublicAccount;
  summary: string;
}

/** The env values the one-click dialog cannot run without. */
interface PlatformApp {
  appId: string;
  appSecret: string;
  configId: string;
}
```

- [ ] **Step 3: Add `signupConfig` and `connectEmbedded`** before `async connection(`:

```ts
  /** Whether this deployment has a platform Meta app to run the dialog with. */
  signupConfig(): SignupConfigPayload {
    const app = this.platformApp();

    return {
      enabled: app !== null,
      appId: app?.appId ?? null,
      configId: app?.configId ?? null,
      graphVersion: this.graphVersion,
    };
  }

  /**
   * The one-click path. Meta's dialog already collected consent, so the work
   * left is making the result ours: trade the code for a token, prove the
   * number belongs to the account they authorised, subscribe our app, and
   * record when the token lapses.
   *
   * Every step is attempted before anything is written. A row saved halfway
   * would sit in "pending" forever and no screen would explain why.
   */
  async connectEmbedded(
    claims: AuthClaims,
    input: EmbeddedSignupDto,
  ): Promise<EmbeddedConnectResult> {
    const app = this.platformApp();

    if (!app) {
      throw new ServiceUnavailableException(
        "One-click setup is not enabled on this server yet. Use credentials instead.",
      );
    }

    const { userId, workspaceId } = await this.workspaces.primaryFor(claims);
    const version = this.graphVersion;
    const token = await this.exchangeCode(app, input.code);

    let owned: string[];

    try {
      owned = await this.meta.listBusinessPhoneNumberIds({
        version,
        businessAccountId: input.wabaId,
        token,
      });
    } catch (error) {
      throw new BadGatewayException(
        `Meta would not list the authorised account's numbers: ${explain(error)}`,
      );
    }

    if (!owned.includes(input.phoneNumberId)) {
      throw new BadRequestException(
        "That phone number is not part of the WhatsApp Business account you authorised. Pick a number from inside the account and try again.",
      );
    }

    const phone = await this.readPhone(version, input.phoneNumberId, token);
    const businessName = await this.readBusinessName(version, input.wabaId, token);

    try {
      await this.meta.subscribeApp({
        version,
        businessAccountId: input.wabaId,
        token,
      });
    } catch (error) {
      throw new BadGatewayException(
        `Meta accepted the connection but would not send events to this app, so nothing would ever arrive: ${explain(error)}`,
      );
    }

    const { expiresAt } = await this.readTokenExpiry(app, version, token);
    const verifiedAt = new Date();

    const values = {
      phoneNumberId: input.phoneNumberId,
      businessAccountId: input.wabaId,
      graphVersion: version,
      appId: app.appId,
      displayPhoneNumber: phone.display_phone_number ?? null,
      verifiedName: phone.verified_name ?? null,
      qualityRating: phone.quality_rating ?? null,
      businessName,
      status: "VERIFIED",
      source: "EMBEDDED_SIGNUP",
      lastVerifiedAt: verifiedAt,
      lastCheckAt: verifiedAt,
      tokenExpiresAt: expiresAt === 0 ? null : new Date(expiresAt * 1000),
      failureReason: null,
      accessTokenCipher: this.box.seal(token),
      // Meta verifies the handshake with the platform token, so this per-row
      // secret is never pasted anywhere; the column is not nullable, so one is
      // minted and left unread rather than special-cased in every read path.
      verifyTokenCipher: this.box.seal(generateVerifyToken()),
      // Deliveries are signed by the platform app secret, not a customer one.
      appSecretCipher: null,
      // `subscribed_apps` is the proof the manual path gets from Meta's GET
      // handshake, so this connection is live the moment it succeeds.
      webhookVerifiedAt: verifiedAt,
    } as const;

    const row = await this.prisma.whatsAppAccount.upsert({
      where: { workspaceId },
      create: { userId, workspaceId, ...values },
      update: values,
      select: ACCOUNT_SELECT,
    });

    const number = phone.display_phone_number ?? `id ${input.phoneNumberId}`;

    return {
      account: this.toPublic(row),
      summary: `Connected ${number}. Meta delivers events here directly — there is nothing to paste into Meta's console.`,
    };
  }
```

- [ ] **Step 4: Add the private helpers** before `private async graphTarget(`:

```ts
  /**
   * Trades Meta's one-shot signup code for a token. The code expires within
   * minutes and works once, so the error tells the customer to retry the
   * button rather than to go hunting for a setting.
   */
  private async exchangeCode(app: PlatformApp, code: string): Promise<string> {
    try {
      return await this.meta.exchangeCode({
        version: this.graphVersion,
        clientId: app.appId,
        clientSecret: app.appSecret,
        code,
      });
    } catch (error) {
      throw new BadGatewayException(
        `Meta did not accept the signup code: ${explain(error)} Codes are single-use, so try the button again.`,
      );
    }
  }

  private async readPhone(
    version: string,
    phoneNumberId: string,
    token: string,
  ): Promise<PhoneNumberDetails> {
    try {
      return await this.meta.getPhoneNumber(version, phoneNumberId, token);
    } catch (error) {
      throw new BadGatewayException(
        `Meta accepted the account but would not describe number ${phoneNumberId}: ${explain(error)}`,
      );
    }
  }

  private async readBusinessName(
    version: string,
    businessAccountId: string,
    token: string,
  ): Promise<string | null> {
    try {
      const business = await this.meta.getBusinessAccount(
        version,
        businessAccountId,
        token,
      );

      return business.name ?? null;
    } catch {
      // A missing display name is cosmetic; the connection is already proven.
      return null;
    }
  }

  /**
   * Mandatory, by product decision: a stored token whose lifetime is unknown is
   * the silent two-month death this feature exists to prevent, so an
   * unreadable expiry refuses the connection instead of storing null.
   */
  private async readTokenExpiry(
    app: PlatformApp,
    version: string,
    token: string,
  ): Promise<{ expiresAt: number }> {
    let debug: { isValid: boolean; expiresAt: number | null };

    try {
      debug = await this.meta.debugToken({
        version,
        appId: app.appId,
        appSecret: app.appSecret,
        token,
      });
    } catch (error) {
      throw new BadGatewayException(
        `Meta accepted the connection but would not confirm when its token expires, so it was not saved: ${explain(error)}`,
      );
    }

    if (!debug.isValid || debug.expiresAt === null) {
      throw new BadGatewayException(
        "Meta accepted the connection but reported its token as invalid or of unknown lifetime, so it was not saved. Try the button again.",
      );
    }

    return { expiresAt: debug.expiresAt };
  }

  /**
   * The three values the dialog cannot run without. The app secret is in the
   * list because the code exchange, `debug_token` and delivery signatures all
   * need it.
   */
  private platformApp(): PlatformApp | null {
    const appId = this.config.get<string>("META_APP_ID");
    const appSecret = this.config.get<string>("META_APP_SECRET");
    const configId = this.config.get<string>("META_ES_CONFIG_ID");

    if (!appId || !appSecret || !configId) return null;

    return { appId, appSecret, configId };
  }

  private get graphVersion(): string {
    return this.config.get<string>("META_GRAPH_VERSION") ?? "v23.0";
  }
```

- [ ] **Step 5: Restore `explain()`** at the bottom of the file, above `blame()`:

```ts
/** One sentence a customer can act on, without Meta's error envelope. */
function explain(error: unknown): string {
  if (error instanceof MetaShapeError || error instanceof MetaTransportError) {
    return error.message;
  }

  if (error instanceof MetaRequestError) {
    return error.explanation;
  }

  return error instanceof Error ? error.message : "Unexpected failure.";
}
```

- [ ] **Step 6: Verify** — `cd Backend; npm run typecheck`. Expected: exit 0.

---

## Task 6: Expiry in the payloads, and the ES branches

**Files:**
- Modify: `Backend/src/whatsapp/whatsapp.service.ts`

**Interfaces:**
- Produces: `PublicAccount.tokenExpiresAt`, `StatusNumber.tokenExpiresAt` (both ISO string or null).

- [ ] **Step 1: Select the column** — add `tokenExpiresAt: true,` to `ACCOUNT_SELECT` and to `STATUS_SELECT`.

- [ ] **Step 2: Publish it** — add to `PublicAccount`: `tokenExpiresAt: string | null;` and inside `toPublic()`: `tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,`.

- [ ] **Step 3: Status payload** — add `tokenExpiresAt: string | null;` to `StatusNumber` and to `numberFrom()`: `tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,`.

- [ ] **Step 4: No per-workspace token for ES rows** — in `toPublic()`, replace `verifyToken: this.openOrNull(row.verifyTokenCipher),` with:

```ts
        // A signup row is verified once for the whole app in Meta's panel, so
        // there is no per-workspace token to hand back.
        verifyToken:
          row.source === "EMBEDDED_SIGNUP"
            ? null
            : this.openOrNull(row.verifyTokenCipher),
```

- [ ] **Step 5: Nothing to rotate on an ES row** — in `rotateVerifyToken`, select `{ id: true, source: true }` and insert after the null check:

```ts
    // An Embedded Signup row has no token in Meta's console to rotate, and
    // minting one here would only throw the connection back to "pending".
    if (row.source === "EMBEDDED_SIGNUP") {
      return { rotated: false, verifyToken: null };
    }
```

- [ ] **Step 6: Verify** — `npm run typecheck` → 0.

---

## Task 7: Endpoints

**Files:**
- Modify: `Backend/src/whatsapp/whatsapp.controller.ts`

- [ ] **Step 1: Add the import** — `import { EmbeddedSignupDto } from "./dto/embedded-signup.dto";`

- [ ] **Step 2: Add the two routes** before `connection()`:

```ts
  /**
   * GET /api/v1/whatsapp/signup-config — whether this server can run Meta's
   * one-click dialog, plus the two ids the browser SDK needs. No Graph call.
   */
  @Get("signup-config")
  signupConfig() {
    return this.whatsapp.signupConfig();
  }

  /**
   * POST /api/v1/whatsapp/embedded-signup — the browser forwards the code and
   * the two ids Meta's dialog returned; the server does the rest.
   *
   * Unlike `connect`, a refusal is a 4xx/5xx with one readable sentence: there
   * is no per-field breakdown to render because the customer typed nothing.
   */
  @Post("embedded-signup")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  embeddedSignup(
    @CurrentUser() claims: AuthClaims,
    @Body() dto: EmbeddedSignupDto,
  ) {
    return this.whatsapp.connectEmbedded(claims, dto);
  }
```

- [ ] **Step 3: Verify** — `npm run typecheck` → 0; `npm run build` → 0; confirm the routes exist in the built output: `Select-String -Path dist\whatsapp\whatsapp.controller.js -Pattern "signup-config|embedded-signup"`.

---

## Task 8: Webhook — platform token and platform signature

**Files:**
- Modify: `Backend/src/whatsapp/whatsapp-webhook.service.ts`

**Interfaces:**
- Consumes: `ConfigService` (`WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `META_APP_SECRET`).
- Produces: no new signature; `handshake()` and `delivery()` gain the platform branches.

- [ ] **Step 1: Re-inject config** — add `import { ConfigService } from "@nestjs/config";` and put `private readonly config: ConfigService,` in the constructor (before `store`).

- [ ] **Step 2: Accept the platform verify token** — in `handshake()`, after the `mode`/`challenge` guards and before the per-row scan:

```ts
    const platformToken = this.config.get<string>("WHATSAPP_WEBHOOK_VERIFY_TOKEN");

    if (platformToken && equals(platformToken, input.token)) {
      this.logger.log("Webhook handshake accepted by the platform token.");
      return { ok: true, challenge: input.challenge };
    }
```

- [ ] **Step 3: Accept the platform signature** — in `delivery()`, before the `changes` parse:

```ts
    // A platform-app delivery is signed with our app secret and a customer-app
    // one with theirs; either proves Meta sent the bytes. Computed once because
    // a single delivery can carry numbers from several workspaces.
    const platformSecret = this.config.get<string>("META_APP_SECRET") ?? null;

    const platformSigned =
      signature !== undefined &&
      platformSecret !== null &&
      signatureMatches(raw, platformSecret, signature);
```

Then change the per-row guard from `if (!rowSigned)` to `if (!rowSigned && !platformSigned)` and keep the existing log line, extending it to name both causes.

- [ ] **Step 4: Verify unsigned deliveries are still refused** — the guard must remain: no signature header at all ⇒ `platformSigned` is false and `rowSigned` cannot be true, so the delivery is ignored. Do not relax it.

- [ ] **Step 5: Verify** — `npm run typecheck` → 0; `npm run build` → 0.

---

## Task 9: Classify an expired token

**Files:**
- Modify: `Backend/src/whatsapp/whatsapp.service.ts` (`type Blame` and `blame()`)

- [ ] **Step 1: Extend the union** — `type Blame = "accessToken" | "expired" | "graphVersion" | "node" | "transport" | "unknown";`

- [ ] **Step 2: Add the branch** inside `blame()`, in the `MetaRequestError` block, before the `code === 190` case:

```ts
    // 190 is "invalid token"; 463 is specifically "session expired". A revoked
    // token and an expired one need different fixes, so they must not share a
    // sentence.
    if (error.code === 190 && error.body.error_subcode === 463) {
      return {
        kind: "expired",
        detail:
          "Meta says this connection's token has expired. Reconnect it with the one-click button on this screen.",
      };
    }
```

- [ ] **Step 3: Verify** — `npm run typecheck` → 0.

---

## Task 10: Frontend API surface

**Files:**
- Modify: `frontend/src/features/whatsapp/components/api.ts`
- Modify: `frontend/src/lib/api/whatsapp-status.ts`

- [ ] **Step 1: Widen the account types**

```ts
  /** `MANUAL` rows were typed in; `EMBEDDED_SIGNUP` rows came from Meta's dialog. */
  source: "MANUAL" | "EMBEDDED_SIGNUP";
  /** When the business token lapses. Null means never-expiring or unknown. */
  tokenExpiresAt: string | null;
```

- [ ] **Step 2: Add the two calls** at the end of the file:

```ts
/**
 * Whether this server can run Meta's one-click dialog. `enabled` is false when
 * the operator has not installed a platform Meta app yet, and the page then
 * leads with the credentials form instead.
 */
export interface SignupConfig {
  enabled: boolean;
  appId: string | null;
  configId: string | null;
  graphVersion: string;
}

export function fetchSignupConfig(): Promise<SignupConfig> {
  return request<SignupConfig>("/v1/whatsapp/signup-config", { method: "GET" });
}

/** What Meta's dialog handed the browser: no token, no secret. */
export interface EmbeddedSignupInput {
  code: string;
  wabaId: string;
  phoneNumberId: string;
}

export function connectEmbeddedSignup(
  input: EmbeddedSignupInput,
): Promise<{ account: WhatsAppAccount; summary: string }> {
  return request("/v1/whatsapp/embedded-signup", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
```

- [ ] **Step 3: Status payload** — add `tokenExpiresAt: string | null;` to the `ConnectionNumber` interface in `frontend/src/lib/api/whatsapp-status.ts`.

- [ ] **Step 4: Verify** — `cd frontend; npx tsc --noEmit` → 0. It will still fail on `source` comparisons until Task 12; if so, finish Task 12 before re-running.

---

## Task 11: Restore the SDK loader and the card

**Files:**
- Restore: `frontend/src/features/whatsapp/components/facebook-sdk.ts`
- Restore: `frontend/src/features/whatsapp/components/embedded-signup.tsx`

- [ ] **Step 1: Restore with git so the bytes are exact**

```powershell
git checkout dd84b05 -- frontend/src/features/whatsapp/components/facebook-sdk.ts frontend/src/features/whatsapp/components/embedded-signup.tsx
```

Do **not** use `git show … > file`: PowerShell 5.1 redirects as UTF-16 and TypeScript will still compile it, hiding the damage until a bundler chokes.

- [ ] **Step 2: Read both files** and confirm the imports resolve against the current tree (`@/components/ui/button`, `@/components/ui/toast`, `./api`). `EmbeddedSignup` must take `{ config: SignupConfig; onConnected: (account: WhatsAppAccount) => void }`.

- [ ] **Step 3: Verify the v4 launch options are intact** — `config_id`, `response_type: "code"`, `override_default_response_type: true`, `extras: { setup: {} }`. If the restored file carries `featureType` or `sessionInfoVersion`, delete those; they belong to the retired v2 shape.

- [ ] **Step 4: Verify** — `npx tsc --noEmit` from `frontend/`.

---

## Task 12: Connection screen — primary, fallback, reconnect, replace

**Files:**
- Modify: `frontend/src/features/whatsapp/components/whatsapp-connection.tsx`
- Create: `frontend/src/features/whatsapp/components/token-expiry.ts`

**Interfaces:**
- Consumes: `fetchSignupConfig`, `SignupConfig`, `EmbeddedSignup`.
- Produces: `View = "auto" | "details" | "waiting" | "reconnect"`.

- [ ] **Step 1: Create `token-expiry.ts`**

```ts
/** Days before expiry at which the connection starts warning. One constant. */
export const TOKEN_WARNING_DAYS = 7;

export type ExpiryState = "none" | "ok" | "soon" | "expired";

/**
 * `null` means "Meta said never, or we never learned" — the honest answer is to
 * say nothing, so this returns "none" rather than inventing a date.
 */
export function expiryState(iso: string | null, now = Date.now()): ExpiryState {
  if (!iso) return "none";

  const at = Date.parse(iso);

  if (Number.isNaN(at)) return "none";

  const days = Math.ceil((at - now) / 86_400_000);

  if (days <= 0) return "expired";

  return days <= TOKEN_WARNING_DAYS ? "soon" : "ok";
}

export function expiryDays(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;

  const at = Date.parse(iso);

  return Number.isNaN(at) ? null : Math.ceil((at - now) / 86_400_000);
}
```

- [ ] **Step 2: Add the `reconnect` view and the signup fetch** — `type View = "auto" | "details" | "waiting" | "reconnect";` plus `signup` and `signupResolved` state, and the `fetchSignupConfig()` call inside the existing load effect, exactly as `dd84b05` had it. A failure must set `signupResolved` true and leave `signup` null so the manual form still renders.

- [ ] **Step 3: Restore the connected handler**

```tsx
  /**
   * Embedded Signup subscribes our app before it answers, so there is no
   * handshake left to wait for: Meta's subscription is the proof, and the
   * screen goes straight to the live panel.
   */
  function handleEmbeddedConnected(next: WhatsAppAccount) {
    setPayload({ account: next, stage: "live", callbackUrl });
    setVerdict(null);
    setView("auto");
    notifyWhatsAppStatus();
  }
```

- [ ] **Step 4: Primary and secondary, with an explicit replace confirmation.** In the `details`/no-account branch render:

  - heading "Connect WhatsApp";
  - primary card: the `EmbeddedSignup` component when `signup?.enabled && signup.appId && signup.configId`, otherwise a short line saying one-click is not configured on this server;
  - secondary: `Collapsible` titled **"I already have my own Meta app"** containing the existing `ConnectForm` (`CredentialsPanel` → `ManualPanel`).

  When `account !== null`, the primary card first renders a confirmation instead of launching. Add the state beside the others:

```tsx
  const [replaceConfirmed, setReplaceConfirmed] = React.useState(false);
```

Reset it whenever the account changes (`React.useEffect(() => setReplaceConfirmed(false), [account?.phoneNumberId])` is wrong under this repo's lint rule — instead reset it in `handleDisconnected` and in `handleEmbeddedConnected`), then render:

```tsx
  const replacing = account !== null;

  // …
  {replacing && !replaceConfirmed ? (
    <div className="rounded-lg bg-secondary px-3 py-2.5 text-[13px] leading-relaxed">
      <p className="text-foreground">
        This workspace is already connected to{" "}
        {account.displayPhoneNumber ?? `ID ${account.phoneNumberId}`}.
        Connecting again replaces its access token and webhook proof. The number
        itself is untouched in Meta.
      </p>
      <Button className="mt-3" onClick={() => setReplaceConfirmed(true)} size="sm">
        Replace this connection
      </Button>
    </div>
  ) : (
    <EmbeddedSignup config={signup} onConnected={handleEmbeddedConnected} />
  )}
```

- [ ] **Step 5: Reconnect view** — add a branch that renders only the card when `view === "reconnect" && account`:

```tsx
      ) : view === "reconnect" && account ? (
        <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <EmbeddedSignup config={signup} onConnected={handleEmbeddedConnected} />
          <Button
            className="mt-4"
            onClick={() => setView("auto")}
            size="sm"
            variant="ghost"
          >
            Cancel
          </Button>
        </section>
```

`signup` may still be null here, and the restored component reads `config.appId`. Pass an explicit disabled config rather than a null:

```tsx
          <EmbeddedSignup
            config={
              signup ?? { enabled: false, appId: null, configId: null, graphVersion: "v23.0" }
            }
            onConnected={handleEmbeddedConnected}
          />
```

- [ ] **Step 6: Verify** — `npx tsc --noEmit`, then `npx eslint src --max-warnings=0`.

---

## Task 13: Live panel wording, expiry row, Reconnect

**Files:**
- Modify: `frontend/src/features/whatsapp/components/live-panel.tsx`
- Modify: `frontend/src/features/whatsapp/components/webhook-fields.tsx`
- Modify: `frontend/src/features/whatsapp/components/whatsapp-connection.tsx` (pass the prop)

**Interfaces:**
- Consumes: `expiryState`, `expiryDays` from Task 12.
- Produces: `LivePanel` gains `onReconnect: () => void`.

- [ ] **Step 1: Platform-aware rows**

```tsx
  const embedded = account.source === "EMBEDDED_SIGNUP";
  const state = expiryState(account.tokenExpiresAt);
  const days = expiryDays(account.tokenExpiresAt);

  const rows: [string, string][] = [
    // …existing rows unchanged…
    [
      "App secret",
      embedded ? "Held by the platform app" : (account.appSecretHint ?? "not stored — reconnect"),
    ],
    // Both are proof Meta will call us, but one was pasted in and the other was
    // subscribed by the API, so the label says which happened.
    [embedded ? "Meta subscription" : "Handshake", when(account.webhook.verifiedAt)],
    [
      "Token expires",
      days === null
        ? "Never expires"
        : state === "expired"
          ? "Expired — reconnect"
          : `in ${days} ${days === 1 ? "day" : "days"}`,
    ],
  ];
```

- [ ] **Step 2: Amber banner + Reconnect**, above the action row, when `state === "soon" || state === "expired"`:

```tsx
      {state === "soon" || state === "expired" ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[13px] leading-relaxed">
          <p className="font-medium text-foreground">
            {state === "expired"
              ? "The access token has expired. Sending is paused until you reconnect."
              : `The access token expires in ${days} ${days === 1 ? "day" : "days"}.`}
          </p>
          <p className="mt-1 text-muted-foreground">
            Meta tokens cannot be refreshed silently — reconnect through Meta to
            issue a new one. The number and its history stay as they are.
          </p>
          <Button className="mt-3" onClick={onReconnect} size="sm">
            Reconnect
          </Button>
        </div>
      ) : null}
```

- [ ] **Step 3: Hide the per-workspace verify token for ES rows** — give `WebhookFields` a `platform?: boolean` prop; when true render only the callback URL plus the sentence "Meta verified this app's callback URL once; the token lives in the server's environment." Pass `platform={embedded}` from the live panel.

- [ ] **Step 4: Wire the prop** — in `whatsapp-connection.tsx` pass `onReconnect={() => setView("reconnect")}` to `LivePanel`, and the same to `ErrorPanel` if it renders an action row (its existing `onEditCredentials` stays for manual rows).

- [ ] **Step 5: Verify** — `npx tsc --noEmit` → 0, `npx eslint src --max-warnings=0` → 0.

---

## Task 14: Verification and evidence

- [ ] **Step 1: Backend gates**

```powershell
cd Backend
npm run typecheck; "TYPECHECK=$LASTEXITCODE"
npm run build; "BUILD=$LASTEXITCODE"
```

- [ ] **Step 2: Frontend gates**

```powershell
cd frontend
npx tsc --noEmit; "TSC=$LASTEXITCODE"
npx eslint src --max-warnings=0; "ESLINT=$LASTEXITCODE"
npm run build; "NEXT=$LASTEXITCODE"
```

Never pipe these into another command; a pipe returns the pipe's exit code.

- [ ] **Step 3: Harness (labelled harness, not production proof)** — `Backend/scripts/check-embedded.cjs` driving the compiled service with a stubbed `meta` and `prisma`, asserting: happy path writes `source`, `appId`, `webhookVerifiedAt`, `tokenExpiresAt`; missing config → 503; number not owned → 400; `subscribeApp` rejection → 502; `debugToken` rejection → 502; `isValid: false` → 502; every refusal leaves zero writes. Delete the script afterwards.

- [ ] **Step 4: Real checks** — with the API running and the app in Development mode:

1. `GET /api/v1/whatsapp/signup-config` returns `enabled: true` with the same app id as `.env`.
2. Click **Connect with Meta**; the popup opens (proves config↔app binding, which no API call can prove).
3. Complete the dialog with a tester account; confirm `POST /embedded-signup` answers 200 and the row shows `source: EMBEDDED_SIGNUP`, a real `tokenExpiresAt`, and `webhookVerifiedAt`.
4. Send a WhatsApp message to the number; the delivery counter moves (proves the platform signature branch).
5. Set the row's `tokenExpiresAt` to 6 days ahead; the amber warning and Reconnect appear.
6. Send a request with a revoked token; the panel shows the expiry/reconnect sentence, not a generic failure.
7. Manual connect on a second workspace still works end to end.

Report each as real or harness. Do not describe step 4 as passed until the counter actually moves.

---

## Task 15: Production requirements (documentation)

Add to the spec's §12 checklist, and mark what is code versus Meta:

**Done by this plan:** endpoints, exchange, ownership check, subscription, `debug_token`, expiry storage, 7-day warning, reconnect, expiry classification, platform signature + handshake, migration.

**Pending on Meta (cannot be done in the repo):** Tech Provider terms, Business Verification, App Review → Advanced Access for `whatsapp_business_management` and `whatsapp_business_messaging`, Access Verification, Facebook Login for Business configuration (domains + OAuth redirect URIs, HTTPS, strict mode, JS SDK), `messages` + `message_template_status_update` + `account_update` subscriptions, privacy policy URL / icon / category before Live.

Until those complete: 10 new accounts per rolling 7 days.

---

## Open items to resolve before Task 12's real test

| Item | Why it blocks |
| --- | --- |
| `META_ES_CONFIG_ID` equals the old `CONFIGUATION_KEY` byte for byte | Either the config was reused (fine) or the new template config's id was never copied in. Only a dialog run settles it. |
| Config → app binding | Not readable via API (`400/2500`). Confirm in App Dashboard → Facebook Login for Business → Configurations, under app `META_APP_ID`. |
| App mode / testers | Development mode limits the dialog to app-role holders. A real customer cannot complete it until Advanced Access is granted. |
| Render environment | Separate copy of all five values; the API must restart before `enabled` turns true there. |
