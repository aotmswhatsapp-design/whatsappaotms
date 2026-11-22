# Template media upload + template detail — design

Status: awaiting review. Scope: IMAGE template headers, their previews, and a
per-template performance screen. WhatsApp channel only.

## Goal

A template's IMAGE header becomes real: the builder uploads a sample image,
this API keeps the original in Supabase Storage, hands Meta a resumable-upload
handle when the template is created, and every screen that shows the template
renders the actual picture through a short-lived signed URL. Clicking a template
card opens its own page with Meta's spend and click figures plus a sent /
delivered / read graph.

## Not in scope

Video and document headers, campaign analytics, template editing at Meta,
changing how a number is registered or verified, a second storage system, the
S3-protocol access path.

Phases: Phase 1 is media (requirements 1-10). Phase 2 is the detail screen.

## Decisions taken

| Decision | Choice | Why |
| --- | --- | --- |
| Meta app id | One platform `META_APP_ID` env var | Matches how tokens are issued today; no change to the connection form |
| Storage access | Existing REST client + `SUPABASE_SECRET_KEY` | The S3 keys add a signer and a second credential set for the same bucket |
| Bucket | New private `template-media`, auto-created | Inbox media and template samples have different lifetimes and owners |
| Folder | `templates/{workspaceId}/{verified-name-slug}/…` | The readable name is for humans; isolation comes from the id segment |
| Handle lifetime | Upload and create in the same request | A handle can never expire between the two calls |
| Handle reuse | Never; re-upload from the stored original | The original in Supabase is the source of truth, Meta's copy is disposable |
| Value stored | Path, mime, size, handle, timestamp | The handle is kept for audit only |
| Insights consent | Explicit button per number | Meta's enablement is irreversible and shares chat data |
| Unique replies | Computed locally | Meta publishes no replies metric |
| Window ratios | Σspent ÷ Σdelivered, not a sum of daily ratios | Meta returns per-day ratios; summing them is arithmetically wrong |

## Configuration changes

### Supabase

1. `TEMPLATE_MEDIA_BUCKET=template-media` in `Backend/.env`,
   `Backend/.env.example` and the host's environment.
2. Bucket `template-media`, private. Created by the existing `ensureBucket()` on
   first upload; no public policy, no RLS policy, no CORS rule. The browser never
   reaches Storage directly.
3. Nothing else. `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are already present and
   are the only credentials used. Project Settings → Storage → global file size
   limit (default 50 MB) already exceeds the 5 MB cap enforced in code.

### Meta

4. `META_APP_ID` in `Backend/.env`, `.env.example` and the host's environment.
   Required by `POST /{app-id}/uploads`; no other credential changes. Checked
   against the tree: `Backend/.env` holds fourteen keys and none of them is
   `META_*`, `env.ts` declares only `META_GRAPH_BASE_URL`, and the connection
   flow is manual credentials — there is no Embedded Signup code here. So this
   id is genuinely new, and the `.env.example` paragraph that reads "there is
   nothing app-wide to configure" has to name this one exception.
5. The stored access token must carry `whatsapp_business_management`, which
   template creation already requires. Nothing to add in the dashboard.
6. Per connected number, one-time `POST /{WABA_ID}?is_enabled_for_insights=true`
   before the first analytics read. Irreversible: enables link tracking and
   anonymized chat-data collection. Triggered by a button, never by a sync.
7. UI copy states Meta's limits: 90-day lookback, read/click data only 7 days
   after a send, clicks only for MARKETING/UTILITY, `COST` absent for accounts on
   a Solution Partner credit line, EU/Japan accounts unsupported.

## Data model (migration `template_media`)

`MessageTemplate` gains five nullable columns; nothing else changes.

- `mediaPath` — Supabase object path.
- `mediaMime` — one of `image/jpeg`, `image/png`, `image/webp`.
- `mediaSize` — bytes, for the audit trail.
- `mediaHandle` — Meta's `4::…` handle, kept for diagnosis.
- `mediaUploadedAt` — when the handle was minted.

`WhatsAppAccount`, `Message` and every registration field stay as they are.

## Storage

`MediaStorage` (inbox) is reused rather than copied:

- constructor gains an optional bucket name, defaulting to today's behaviour, so
  `InboxModule` is untouched;
- a new `download(path)` reads the object back with the service key;
- `TemplatesModule` provides a second instance through `useFactory` with
  `template-media`.

Paths are `templates/{workspaceId}/{verifiedNameSlug}/{templateNameSlug}-{short}.{ext}`.
The folder name is resolved from `verifiedName`, then `businessName`, then
`phoneNumberId`, and slugged. A later rename does not move existing objects — the
stored path is the address.

Isolation is enforced by the API, not by Storage: every read and every create
filters on `workspaceId`, and a client-supplied `mediaPath` is rejected unless it
starts with `templates/{workspaceId}/`. A foreign or missing `id` answers 404, so
the endpoint cannot be used to probe for existence.

## Backend API

### `POST /v1/templates/media` (multipart, field `file`)

Validates, in this order: non-empty body; ≤5 MB (`FileInterceptor` limit and a
second check in the service); declared MIME in the allowlist **and** matching
magic bytes (`FF D8 FF`, `89 50 4E 47`, `RIFF….WEBP`); not an animated WebP;
≤4096 px per edge, read from the JPEG SOF or PNG IHDR header. Writes the object
and answers `{ path, previewUrl, mime, size }`, where `previewUrl` is a 300 s
signed URL.

### `GET /v1/templates/:id/media`

Workspace-scoped lookup, then a fresh signed URL. 404 when the template is not
the caller's, or has no stored image. The 300 s lifetime is deliberate: the
client refetches instead of holding a link that dies mid-session.

### `POST /v1/templates`

`CreateTemplateDto` gains `headerFormat?: "TEXT" | "IMAGE"` and `mediaPath?: string`.
`header` keeps meaning the TEXT header's text, and an absent `headerFormat`
means TEXT, so every existing client keeps working untouched.

1. `problemsIn` requires `mediaPath` when the header format is IMAGE, and requires
   the TEXT header text otherwise.
2. The service checks the path's workspace prefix and downloads the original.
3. `MetaGraph.uploadTemplateMedia` runs the two-step resumable upload and returns
   the handle.
4. `buildComponents` emits `{ type: "HEADER", format: "IMAGE", example: { header_handle: [handle] } }`.
5. The creation call runs; the returned row is upserted **with** the five media
   columns.

A Meta failure after a successful upload leaves the object and its preview in
place — a retry re-uploads from Supabase and does not ask the user for the file
again. A Supabase failure answers 502 and writes no row.

### `GET /v1/templates/:id/analytics?days=30`

One `template_analytics` call (`granularity=DAILY`, `metric_types=cost,clicked,delivered,read,sent`,
`template_ids=[metaId]`, ≤10 respected). Days are clamped to 90. The answer:

- `spend`, `costPerDelivered`, `costPerUrlClick` — `cost[amount_spent]` summed,
  and the two ratios recomputed over the window as Σspent ÷ Σdelivered and
  Σspent ÷ Σ `url_button` clicks. `null` when the denominator is zero or Meta
  omitted the type.
- `sent`, `delivered`, `read` — summed over days.
- `uniqueReplies` — distinct conversations that received this template in the
  window and then produced an inbound message. Local only; it covers sends made
  through this app.
- `daily` — per-day series for the graph.
- `currency`, `window`, `insightsEnabled`, and `unavailable: string[]` naming the
  reads Meta refused, in the same shape as the analytics overview.

`POST /v1/templates/:id/insights` performs the one-time enablement and returns the
new state. It is idempotent from the UI's point of view and never runs implicitly.

## Frontend

| File | Change |
| --- | --- |
| `features/templates/api.ts` | `uploadTemplateMedia`, `fetchTemplateMedia`, `fetchTemplateAnalytics`; media fields on the types; `headerFormat`/`mediaPath` on the draft |
| `features/templates/rules.ts` | IMAGE requires an image; TEXT keeps its 60-character rule |
| `components/template-builder.tsx` | Image chip becomes a dropzone with preview, replace and remove; submit waits for the upload |
| `components/template-card.tsx` | Renders the signed-URL `<img>`; falls back to today's grey header with "Sample image unavailable" |
| `components/templates-view.tsx` | Each card becomes one link to the detail route |
| `features/inbox/template-shape.ts`, `components/template-panel.tsx` | Same image in the selected-template preview |
| `features/templates/use-template-media.ts` (new) | Fetch on mount, refetch near expiry or after a failure |
| `app/(app)/workspace/templates/[id]/page.tsx` (new) | Preview left, money and performance right, graph below |

The graph reuses `TrendCard` with a Sent / Delivered / Read switch; no chart
library is added.

## Error handling

| Failure | Behaviour |
| --- | --- |
| Storage unconfigured | 503, "Template storage is not configured." |
| Upload rejected by validation | 400 naming the rule that failed |
| Supabase write fails | 502, no row written |
| Meta upload refused | 502 with Meta's own sentence |
| Template refused after upload | 502; the image still previews |
| Signed URL expired | Client refetches; no user-visible error |
| No image stored | Placeholder plus "Sample image unavailable" |
| Template deleted at Meta | Row and media kept; no handle requested |
| Insights not enabled | Tiles show "Enable insights", not zeros |
| Meta omits `cost` | Tile shows "Not available", never `0.00` |

## Security

The secret key and the Meta access token never leave the API. The bucket is
private. The only thing the frontend ever receives is a 300 s signed URL scoped to
one object. Every route resolves the workspace from the bearer token; no
workspace id is accepted from the client.

## Testing

- Unit: `problemsIn` for both header formats; path-prefix rejection; the ratio
  arithmetic (Σspent ÷ Σdelivered) against a hand-built two-day fixture.
- Integration: upload rejects a PNG renamed to `.jpg`, a 6 MB file, an animated
  WebP and a 5000 px image; a second workspace gets 404 for a foreign template id.
- Meta client: resumable upload against a stub, asserting the two calls, the
  `file_offset: 0` header and the space-separated `Authorization: OAuth` form.
- Browser: builder upload shows a preview, the card renders the same image, the
  inbox panel renders it, and killing the signed URL falls back to the labelled
  placeholder.

## Requirement traceability

| Requirement | Where |
| --- | --- |
| 1 private bucket | Configuration 1-2 |
| 2 upload + signed URLs | Storage, `POST /v1/templates/media`, `GET …/media` |
| 3 tenant isolation | Path prefix check, workspace-scoped lookups, 404 policy |
| 4 IMAGE header, original kept | Builder, storage, path convention |
| 5 resumable upload with WABA + app id | `MetaGraph.uploadTemplateMedia`, `META_APP_ID` |
| 6 `header_handle` at creation | Creation flow step 4 |
| 7 path + handle persisted per template | Migration `template_media` |
| 8 cards and inbox previews | Frontend table |
| 9 graceful failures | Error handling table |
| 10 validation, no secret exposure | Validation order, Security |
| Detail page | `GET …/analytics`, `templates/[id]` |
