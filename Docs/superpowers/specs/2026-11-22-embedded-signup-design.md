# Embedded Signup (v4) — Design

**Date:** 2026-11-22
**Status:** Draft, awaiting review
**Scope:** Restore Meta Embedded Signup as an additional connection path, adapted to
the current workspace-tenancy model.

---

## 1. Problem

Today the only way to connect a WhatsApp number is the five-field manual form
(`POST /v1/whatsapp/connect`). Every workspace brings its own Meta app, token,
app secret and verify token. The product now needs Meta's one-click dialog:
the customer clicks a button, authorises their WhatsApp Business account inside
Meta's popup, and the platform app receives a code it exchanges for a business
token.

### What already exists

The feature was built on 2026-11-19 (`dd84b05`, 1,620 insertions) and removed on
2026-11-20 (`f38aabc`, 1,371 deletions) when the product deliberately moved to
per-workspace Meta apps. This design **restores that implementation and adapts
it** rather than reinventing it. Nothing in `f38aabc` was removed for being
broken; it was removed for being the wrong product model at the time.

Consequently: `WhatsAppSource.EMBEDDED_SIGNUP` still exists in the schema, and
`MetaGraph.subscribeApp` still exists (with a different signature).

---

## 2. Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| App model | **Coexist.** Manual form stays; ES is added beside it. | Least disruptive. Existing customers keep working; no forced re-onboarding. |
| Token lifetime | **60-day, confirmed** by the operator's Facebook Login for Business configuration. Read it back with `debug_token` after exchange and persist `tokenExpiresAt`. | The lifetime is now a known fact, not a guess. The read-back keeps the stored value true even if the configuration is ever recreated with a different lifetime. |
| `debug_token` failure | **Fatal for the connection:** `502`, nothing written. | The operator requires expiry to be known. A stored row with unknown expiry is exactly the silent-death case this design exists to prevent. |
| Expiry at call time | Classify Meta `190`/`463` as `expired`, mark the row `FAILED` with a reconnect sentence. | A warning nobody reads is useless if sends keep failing with a generic error. |
| Config delivery | **Server endpoint** (`GET /v1/whatsapp/signup-config`). | The app id and config id are public, but serving them from the API means no `NEXT_PUBLIC_*` build-time variables and one place to disable the feature. |
| ES version | **v4 only.** | v2/v3 were deprecated 15 Oct 2026. |
| Code exchange | Server-to-server only, always. | The code is single-use with a 5-minute TTL and must never be traded in the browser. |
| Phone registration | **Not built in v1.** | The v4 dialog registers the number. If Meta answers "not registered", surface Meta's sentence rather than adding a PIN form nobody asked for. |
| `account_update` webhook | **Out of scope for v1.** | Needed eventually to detect a customer removing the app; not needed to go live. |
| Restored source | `dd84b05`, adapted per §5. | Cheaper and better-tested than a rewrite. |

---

## 3. Environment

`Backend/.env` (and `.env.example`, and the host environment):

| Key | Required | Purpose |
| --- | --- | --- |
| `META_APP_ID` | for ES | `FB.init({appId})`, `debug_token`, and `/{app-id}/uploads`. Already declared optional in `env.ts`. |
| `META_APP_SECRET` | for ES | Code exchange + webhook signature verification. Must belong to the same app that owns the config id. |
| `META_ES_CONFIG_ID` | for ES | The Facebook Login for Business configuration passed as `config_id`. |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | for ES | Meta verifies the callback URL once for the whole app, not once per workspace. |
| `META_GRAPH_VERSION` | optional | Default `v23.0`. Meta's current ES docs show `v27.0`. |

**Repair needed:** the operator added the configuration id as `CONFIGUATION_KEY`
(16 digits, currently unread by any code). It will be renamed to
`META_ES_CONFIG_ID`.

No frontend environment variables. The browser asks the API.

**All five stay optional in the Zod schema.** An unconfigured deployment must
still boot and still offer the manual path; only the ES endpoints answer 503.

Local `.env` and the host's environment (Render) are independent copies — the
values must be added in both, and the API restarted, before `enabled` turns
true.

### 3.1 Pre-flight gate (blocks implementation)

**No implementation begins until the configuration ID is verified against the
same Meta app as `META_APP_ID`.** The operator creates the configuration from
Meta's *WhatsApp Embedded Signup* template with the 60-day expiry token, then:

1. it appears under App Dashboard → **Facebook Login for Business → Configurations**;
2. its ID replaces the misspelled `CONFIGUATION_KEY` in `Backend/.env` as `META_ES_CONFIG_ID`;
3. the two IDs are confirmed to sit under the same app (the config list is scoped to the app, so a config from another app simply will not be listed there).

Why this is a hard gate rather than a formality: a configuration ID from a
different app makes `FB.login` fail with a scopes/configuration error that
looks like a browser bug, and every hour spent debugging the frontend would be
wasted. The configuration ID is not a secret; `META_APP_SECRET` is.

---

## 4. Data model

One nullable column:

```prisma
/// When the stored business token lapses, as Meta reported at connect time.
/// Null means either "Meta said it never expires" or "not yet read" — the UI
/// says nothing rather than guessing, matching how `currency` behaves.
tokenExpiresAt DateTime? @map("token_expires_at")
```

Migration: `0013_embedded_signup_expiry` (latest is `0012_analytics_snapshots`).

No enum change, no index. `source` already distinguishes the two paths, and
`workspaceId` is already `@unique` — one connection per workspace, whichever
path created it.

---

## 5. Backend

### 5.1 `dto/embedded-signup.dto.ts` (restore verbatim)

`code` (10–2048 chars, trimmed), `wabaId` and `phoneNumberId`
(`/^\d{5,25}$/`, trimmed). No token, no secret: the browser never sees a
credential.

### 5.2 `MetaGraph`

Restore two deleted methods and add one:

```ts
exchangeCode(input: {
  version: string; clientId: string; clientSecret: string; code: string;
}): Promise<string>
// GET /{version}/oauth/access_token?client_id&client_secret&code
// Throws MetaShapeError when no access_token comes back.

listBusinessPhoneNumberIds(
  version: string, businessAccountId: string, token: string,
): Promise<string[]>
// GET /{waba}/phone_numbers?fields=id

debugToken(input: {
  version: string; appId: string; appSecret: string; inputToken: string;
}): Promise<{ isValid: boolean; expiresAt: number }>
// GET /{version}/debug_token?input_token=&access_token={appId}|{appSecret}
// expiresAt is Meta's epoch seconds; 0 means "never".
// Called with the app access token. A failure is fatal, not swallowed: see §5.3.
```

Reuse the existing `subscribeApp({ version, businessAccountId, token })` — only
its call signature differs from the deleted one.

### 5.3 `WhatsAppService`

```ts
signupConfig(): SignupConfigPayload
// { enabled: boolean; appId: string | null; configId: string | null; graphVersion: string }
// enabled is true only when all three of appId/appSecret/configId are present.

async connectEmbedded(claims, input: EmbeddedSignupDto): Promise<EmbeddedConnectResult>
```

`connectEmbedded` order of operations — nothing is written until every step has
succeeded:

1. `platformApp()` → `null` means `503 "One-click setup is not enabled on this server yet. Use credentials instead."`
2. `const { userId, workspaceId } = await this.workspaces.primaryFor(claims)` — **not** the deleted `users.syncFromClaims`.
3. `exchangeCode` → business token. Any failure: `502` naming the code as single-use.
4. `listBusinessPhoneNumberIds` → must contain `input.phoneNumberId`, else `400 "That phone number is not part of the WhatsApp Business account you authorised…"`. This is the only guard that stops one tenant claiming another's number.
5. `getPhoneNumber` + `getBusinessAccount` (name failure is cosmetic, returns null).
6. `subscribeApp` → failure is `502` and nothing is persisted.
7. `debugToken` → **mandatory**. Two failures are both `502` and both write nothing:
   the call itself failing ("Meta accepted the connection but would not confirm when its token expires, so it was not saved"), and `isValid: false` (a token Meta calls invalid cannot have authorized `subscribed_apps` legitimately).
8. Upsert:

```ts
const values = {
  phoneNumberId, businessAccountId: wabaId, graphVersion: version,
  appId: app.appId,              // NEW: image uploads address the platform app
  displayPhoneNumber, verifiedName, qualityRating, businessName,
  status: "VERIFIED", source: "EMBEDDED_SIGNUP",
  lastVerifiedAt: now, lastCheckAt: now, webhookVerifiedAt: now,
  tokenExpiresAt: expiresAt === 0 ? null : new Date(expiresAt * 1000),
  failureReason: null,
  accessTokenCipher: box.seal(token),
  verifyTokenCipher: box.seal(generateVerifyToken()), // never read for ES rows
  appSecretCipher: null,                              // the platform app signs
} as const;

prisma.whatsAppAccount.upsert({
  where: { workspaceId },                       // was `userId` in dd84b05
  create: { userId, workspaceId, ...values },
  update: values,
  select: ACCOUNT_SELECT,
});
```

### 5.4 Controller (restore)

| Route | Behaviour |
| --- | --- |
| `GET /v1/whatsapp/signup-config` | `signupConfig()`. Cheap, no Graph call, no throttle beyond the global one. |
| `POST /v1/whatsapp/embedded-signup` | `connectEmbedded()`, `@HttpCode(200)`, `@Throttle(10 / 60s)`. |

Refusals are plain 4xx/5xx with one sentence — there is no per-field breakdown
because the customer typed nothing.

### 5.5 Restore the `source` branches

Two places special-case ES rows and both were removed:

- `rotateVerifyToken` → `{ rotated: false, verifyToken: null }` for ES rows (there is no Meta console field to paste into).
- `status` / `connection` payload → `verifyToken: null` for ES rows.

### 5.6 Webhook (restore, mandatory)

Without this every ES delivery is dropped as unsigned:

- `handshake`: accept `WHATSAPP_WEBHOOK_VERIFY_TOKEN` before the per-workspace scan, logging that the platform token matched.
- `deliver`: compute `platformSigned` once from `META_APP_SECRET`; accept a row when `rowSigned || platformSigned`. Keep the existing warning text for rows with no secret that also fail the platform signature.

`WhatsAppWebhookService` gets `ConfigService` back in its constructor.

### 5.7 Expiry at call time

Storing an expiry is only half the requirement; the connection must also *report*
when the token is already dead. `blame()` in `whatsapp.service.ts` already maps
code `190` to `kind: "accessToken"`. It gains one earlier branch:

```ts
const subcode = error.body.error_subcode;

if (error.code === 190 && subcode === 463) {
  return {
    kind: "expired",
    detail:
      "Meta says this connection's token has expired. Reconnect it with the " +
      "one-click button on this screen.",
  };
}
```

Consequences:

- The `Blame` union gains `"expired"`. `recheck()` already persists
  `verdict.detail` into `failureReason` with `status: "FAILED"`, so the sidebar
  dot turns red and the error panel prints the reconnect sentence with no new
  branch.
- A plain `190` without `463` keeps the existing "Meta rejected the access
  token" wording — a revoked token and an expired one are different fixes, and
  `467` (invalid token) must not be mislabelled as expiry.
- `graphFailure()` carries the same sentence to any send that hits it, so the
  inbox reports the cause instead of "Meta refused the request".

---

## 6. Frontend

| File | Change |
| --- | --- |
| `features/whatsapp/components/facebook-sdk.ts` | Restore (270 lines): singleton script load, `FB.init`, `runEmbeddedSignup`, `WA_EMBEDDED_SIGNUP` message listener with CANCEL/ERROR/FINISH handling. |
| `features/whatsapp/components/embedded-signup.tsx` | Restore (243 lines): loading/ready/failed SDK state, busy state, inline error, `FacebookMark`. |
| `features/whatsapp/components/api.ts` | Restore `SignupConfig`, `EmbeddedSignupInput`, `fetchSignupConfig`, `connectEmbeddedSignup`; widen `source` back to `"MANUAL" \| "EMBEDDED_SIGNUP"`. |
| `features/whatsapp/components/whatsapp-connection.tsx` | Restore the `signup`/`signupResolved` fetch, the `EmbeddedSignup` card, `handleEmbeddedConnected`, and the credentials form inside a `Collapsible` ("I already have my own Meta app"). `ManualPanel` returns as the disclosed component. Add `"reconnect"` to the `View` union (`"auto" \| "details" \| "waiting"`) so an already-connected workspace can reopen the dialog: that view renders only the `EmbeddedSignup` card, and `handleEmbeddedConnected` returns to the live stage with the new account. |
| `features/whatsapp/components/live-panel.tsx` | Restore the `embedded` row variants: "App secret → Held by the platform app", "Meta subscription" instead of "Handshake". Add the token-expiry row and the "Reconnect" CTA described in §9. |
| `frontend/src/lib/api/whatsapp-status.ts` | Add `tokenExpiresAt: string \| null` to the connection number payload so the sidebar/status consumers see the same field. |

UX rule preserved from `dd84b05`: the screen must not claim one-click is
unavailable until `signupResolved` is true, and a failed `signup-config` call
must never block the credentials form.

---

## 7. Flow

```
page load ─► GET /signup-config
                │ enabled=false ─► credentials form (open)
                └ enabled=true  ─► EmbeddedSignup card + credentials (collapsed)

click ─► load SDK ─► FB.init({appId, version})
      ─► FB.login(cb, {config_id, response_type:"code",
                       override_default_response_type:true, extras:{setup:{}}})

message listener (WA_EMBEDDED_SIGNUP)
   FINISH / FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING → phone_number_id, waba_id
   CANCEL → current_step      (no server call)
   ERROR  → error_message, error_code, session_id (no server call)

cb.authResponse.code ─► POST /embedded-signup {code, wabaId, phoneNumberId}
      server: exchange → ownership check → read phone → subscribe → debug_token → upsert
      ─► { account, summary } ─► live panel
```

Closing the popup on the final screen counts as success for the session message,
but the code only arrives when **Finish** is clicked. So a FINISH without a code
is not an error — the screen says the account was created and offers the button
again.

---

## 8. Error handling

| Situation | Behaviour |
| --- | --- |
| Env incomplete | `signup-config.enabled === false`; endpoints `503` with one sentence; manual form is the front door. |
| Code expired / already used | `502`: "Meta did not accept the signup code … Codes are single-use, so try the button again." |
| Number not in the authorised account | `400` naming the mismatch. |
| `subscribed_apps` fails | `502`; no row written. |
| `debug_token` fails or returns invalid | `502`; nothing written. Retry the button; the manual path still works. |
| Token expired at call time (`190`/`463`) | Row marked `FAILED` with the reconnect sentence; error panel and sidebar both point at the reconnect button. |
| SDK blocked (ad blocker, CSP) | `embedded-signup.tsx` shows the failure and keeps the credentials form reachable. |
| Customer closes popup mid-flow | CANCEL `current_step` rendered as a sentence; nothing written. |

---

## 9. Token expiry (60-day, confirmed)

### 9.1 Stored state

- `debug_token.expires_at` is Meta's epoch seconds; `0` means "never" and is stored as `null`. With the operator's 60-day configuration, every ES row stores a real timestamp.
- `tokenExpiresAt` is exposed on `connection` (inside `account`) and inside `status.number`, so the settings screen and the sidebar both decide without a second call.

### 9.2 Seven-day warning

- `daysLeft = ceil((tokenExpiresAt − now) / 86_400_000)`.
- `daysLeft > 7` → no warning; the live panel shows the expiry date as plain text.
- `1 ≤ daysLeft ≤ 7` → amber row: "Token expires in N days" with a **Reconnect** button.
- `daysLeft ≤ 0` → §9.4, not the warning.
- The threshold lives in one constant (`TOKEN_WARNING_DAYS = 7`) shared by the panel and the sidebar, so the two cannot disagree.

### 9.3 Reconnect flow

1. The live panel (amber) or the error panel (red) renders **Reconnect**.
2. It sets `view = "reconnect"`; that view mounts `EmbeddedSignup` only.
3. The dialog runs exactly as the first time. The server path is the same `POST /embedded-signup`, which upserts by `workspaceId` and overwrites the token, `tokenExpiresAt` and `webhookVerifiedAt`.
4. `handleEmbeddedConnected` returns to the live stage with the new account.
5. No confirmation prompt on this path: the customer just clicked the button that says the connection is being replaced. The confirmation in §10 applies to a *first* ES connection over an existing manual one.

### 9.4 Expired

- Detection is at call time (§5.7), not on a timer. Nothing runs on a schedule, so a token that lapses while nobody uses the app turns red on the next read or send — not at the instant it expires.
- `recheck()` writes `FAILED` plus the reconnect sentence; `deriveStatus` then reports `state: "error"`, which routes the screen to `ErrorPanel`.
- The inbox send path reports the same sentence through `graphFailure`.

### 9.5 What cannot be built

- **No silent refresh.** A business integration token cannot be renewed without the customer present, so there is no refresh token, no cron job, and no "extend" button. The dialog is the only renewal.
- Expiries cluster: everyone onboarded in the same week lapses in the same week ten weeks later. The 7-day warning is the only defence, so it is not decoration.

---

## 10. Security

- The code is exchanged server-side only and never logged.
- `META_APP_SECRET` is read through `ConfigService` and never leaves the API; it is not returned by any endpoint.
- ES rows store `appSecretCipher: null` and are verified by the platform secret. A row that does have its own secret still verifies on it first.
- Ownership check (`listBusinessPhoneNumberIds`) is the only proof the authorised account contains the number; the dialog's `phone_number_id` alone is not trusted.
- `workspaceId @unique` means connecting through ES **replaces** an existing manual connection for that workspace. The UI must ask for confirmation when `account !== null` before launching the dialog.

---

## 11. Testing

**Unit / harness (no network, no DB):**
- `MetaGraph.exchangeCode` builds the documented URL and throws `MetaShapeError` on a missing token.
- `MetaGraph.debugToken` maps `expires_at: 0` to `0` (never) and a real epoch to seconds.
- `connectEmbedded` with a stubbed `prisma` + `meta`:
  - happy path writes `source: EMBEDDED_SIGNUP`, `appId`, `webhookVerifiedAt`, and `tokenExpiresAt`;
  - missing config → 503 and zero writes;
  - number not in the WABA list → 400 and zero writes;
  - `subscribeApp` rejection → 502 and zero writes;
  - `debug_token` rejecting the call → 502 and zero writes;
  - `debug_token` answering `is_valid: false` → 502 and zero writes.
- `blame()` classifies `190` + subcode `463` as `expired`, and `190` alone as `accessToken`.
- Warning boundary: 8 days left → no warning, 7 days → amber, 0 days → error panel.
- Webhook: a platform-signed delivery is accepted for an ES row with no stored secret; a wrong signature is ignored.

**Gates:** backend `npx tsc --noEmit` + `npm run build`; frontend `npx tsc --noEmit`, `npx eslint src --max-warnings=0`, `npm run build`.

**Manual:** one full dialog run on a dev-mode tester account. Non-testers cannot
exercise it until App Review passes.

---

## 12. Launch prerequisites (Meta side, not code)

**Done in this repository (code):** the two endpoints (`GET /v1/whatsapp/signup-config`, `POST /v1/whatsapp/embedded-signup`), the server-side code exchange, the phone-ownership check against the authorised WABA, `POST /{waba}/subscribed_apps`, `debug_token` expiry verification, `tokenExpiresAt` persistence and migration `0013_embedded_signup_expiry`, the 7-day warning and Reconnect CTA, the `190`/`463` expired classification, the platform verify token and platform app-secret signature branch, and the pre-ES-replacement confirmation prompt.

**Pending on Meta — none of these can be satisfied from this repository:**

1. Tech Provider terms accepted for the app.
2. Business Verification of the owning business portfolio.
3. App Review → **Advanced Access** for `whatsapp_business_management` and `whatsapp_business_messaging`.
4. Access Verification.
5. Facebook Login for Business configuration with Allowed domains and Valid OAuth redirect URIs (HTTPS, strict mode, JS SDK login enabled).
6. `account_update` webhook field subscribed (even though v1 does not handle it, Meta expects the subscription).
7. Privacy policy URL, app icon, category — required before the Live switch.
8. Each customer adds a payment method in WhatsApp Manager.

Until 2–4 are complete: **10 new accounts per rolling 7 days**; after, 200.

Until App Review passes, the dialog only completes for holders of a role on the
app (Development mode testers). Customer-facing rollout therefore waits on
items 2–4, not on code.

---

## 13. Out of scope (v1)

- `account_update` webhook handling and automatic disconnect.
- `POST /{phone_number_id}/register` (6-digit PIN) fallback.
- Multi-WABA selection (`waba_ids[]`); v1 uses the single `waba_id`.
- Sandbox accounts and the WABA → WhatsApp Account (WAAC) messaging-account split.
- Any client-side token exchange.

---

## 14. Risks

| Risk | Mitigation |
| --- | --- |
| Coinbase-style cross-tenant claim | Ownership check before any write. |
| Silent failure in two months (60-day token) | `debug_token` at connect + expiry CTA at 7 days. |
| Restored code is three days old and predates current conventions | Adapt per §5; run all five gates; the diff is reviewed against `dd84b05` line by line. |
| ES row overwrites a manual connection | Confirmation prompt when `account !== null`. |
| `debug_token` outage blocks onboarding | Deliberate, per the operator's requirement that expiry is always known. The 502 names the cause and the manual path is unaffected. |
| Meta renames WABA → Messaging account | The column stays `businessAccountId`; only copy changes. |
