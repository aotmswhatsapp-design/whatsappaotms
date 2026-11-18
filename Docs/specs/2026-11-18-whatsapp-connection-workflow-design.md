# WhatsApp connection workflow

Status: approved 2026-11-18. Scope: `Backend/src/whatsapp/**`, `frontend/src/features/whatsapp/**`,
sidebar status dot.

## Goal

Take a customer from "I have Meta credentials" to "my number is live" without
leaving the workspace. Credentials are verified against Graph, the API hands
back the callback URL and verify token that Meta demands, the page waits for
Meta's first handshake, and the sidebar item carries a colour that says whether
the connection works.

## Model

One Meta app per customer, one callback URL for the platform
(`WHATSAPP_WEBHOOK_PUBLIC_URL`). The verify token is generated per workspace,
so two customers can share the callback without one being able to answer for
the other. The app secret is per customer because each customer registers their
own app.

## Stages

| Stage   | Server truth                                    | Screen |
| ------- | ----------------------------------------------- | ------ |
| details | no row                                          | five fields |
| webhook | row, `webhook_verified_at` is null              | callback + verify token |
| waiting | row, still no handshake (client-side state)     | poll every 3 s, 2 min |
| live    | row, `webhook_verified_at` set                  | green panel |
| error   | row with `status = FAILED`                      | red panel, reason |

`stage` is derived by the API so a reload lands in the right place.

## Data model (`whatsapp_accounts`)

Added, all nullable or defaulted so existing rows survive:

- `app_secret_cipher` — AES-256-GCM, like the other secrets.
- `webhook_verified_at` — stamped by the GET handshake.
- `last_event_at`, `event_count` — delivery proof, no message content stored.
- `last_check_at`, `failure_reason` — cache and wording for the live re-check.

`status` stays `VERIFIED | FAILED`; amber is derived (`VERIFIED` without
`webhook_verified_at`), never stored.

## API

Guarded, `v1/whatsapp`:

- `POST /connect` — five fields: access token, phone number ID, app secret,
  Graph version, Whatsapp account ID. Generates the verify token. Persists only
  when every Graph check passes.
- `GET /connection` — public account, `stage`, callback URL, full verify token,
  webhook block (`verifiedAt`, `lastEventAt`, `eventCount`), `failureReason`.
- `POST /verify-token/rotate` — new token, clears `webhook_verified_at`.
- `GET /status` — `none | pending | live | error` plus a reason; re-checks Meta
  at most once per five minutes (`last_check_at`).
- `POST /check` — same re-check, forced.
- `DELETE /connection` — unchanged.

Public, `v1/whatsapp/webhook`, no guard, unthrottled:

- `GET` — `hub.verify_token` compared against every stored account with
  `timingSafeEqual`; match stamps `webhook_verified_at` and echoes
  `hub.challenge` as `text/plain`. No match: 403.
- `POST` — `X-Hub-Signature-256` HMAC-SHA256 over the raw bytes with the
  resolved account's app secret. Resolves the account by
  `entry[].changes[].value.metadata.phone_number_id`, then bumps
  `last_event_at` and `event_count`. Unknown accounts and bad signatures are
  logged and answered 200 so Meta stops retrying a request we will never accept.

`main.ts` gains `rawBody: true`; a parsed-then-reserialised body cannot be
signed.

## Client

- `src/lib/api/http.ts` — the auth-aware `request`/`ApiError` pair, moved out of
  the feature so the shell can use it without importing a feature.
- `src/features/whatsapp/components/api.ts` — feature calls on top of it.
- `whatsapp-connection.tsx` — four-stage wizard, holds `account`, polling and
  the last verdict.
- `connect-form.tsx` — five inputs; the app secret row says *format accepted,
  proof arrives with the first signed delivery* rather than claiming Meta
  confirmed it.
- `webhook-panel.tsx` — callback URL and verify token with copy buttons, rotate,
  numbered developers.facebook.com steps.
- `waiting-panel.tsx` — explained wait, three usual causes, Check again.
- `live-panel.tsx` — number, verified name, quality, callback, last delivery,
  count, disconnect.
- `src/components/ui/status-dot.tsx` — presentational: lime live, amber pending,
  red with the reason, nothing when unset. Colour is never the only channel;
  every dot carries a `title` and `aria-label`.

The shell polls `/status` once per mount and receives a cached answer.

## Config

```
WHATSAPP_WEBHOOK_PUBLIC_URL=https://api.example.com/api/v1/whatsapp/webhook
```

Unset ⇒ `callbackUrl: null` and the panel states that the API is not
configured, instead of rendering a URL nobody registered.

## Verification

1. Migration applies to Supabase; `prisma generate` runs.
2. `tsc --noEmit`, `eslint`, `next build` clean in both projects.
3. Graph stubbed (`META_GRAPH_BASE_URL`) for the five checks.
4. Handshake simulated with `curl` (right token 200 + challenge, wrong token
   403); a signed POST bumps the counters; an unsigned POST is refused but
   answered 200.
5. Playwright: details → webhook → waiting → live, screenshots at each stage,
   sidebar dot green; wrong-token handshake leaves the dot amber; expired token
   turns it red.
