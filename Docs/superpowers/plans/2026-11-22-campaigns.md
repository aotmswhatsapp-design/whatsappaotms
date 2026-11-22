# Campaigns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build AOTMS campaigns — pick an approved template and a tag audience, send it to every matched contact through their own Inbox conversation, and report delivery from the webhook data that already exists.

**Architecture:** A `Campaign` row plus one `CampaignRecipient` per contact, materialised when the campaign starts. An in-process `CampaignsRunner` claims due campaigns with one conditional `UPDATE`, then drains recipients in batches of 10 through the existing `InboxSender.template(...)`, writing `Message.campaignId` so insights are a `groupBy` over messages and cannot drift.

**Tech Stack:** NestJS 11 + Prisma 6 (PostgreSQL/Supabase) on the backend; Next 16 App Router + React 19 + Tailwind 4 on the frontend. No queue, no Redis, no test runner — every task is verified with `tsc`, `nest build`, `prisma validate`, a Node probe against `dist`, and finally a browser pass.

**Spec:** `Docs/superpowers/specs/2026-11-22-campaigns-design.md`

## Global Constraints

- One WhatsApp number per workspace: `WhatsAppAccount.workspaceId` is `@unique`. Never accept a workspace or account id from the client — resolve it with `WorkspacesService.primaryFor(claims)`.
- Only `MessageTemplate.status === "APPROVED"` may be sent. Reuse `problemsIn` / `buildMessage` / `shapeOf` from `Backend/src/inbox/template-send.ts`; never rebuild template payloads.
- Machine-readable error codes on every refusal, in the inbox's shape: `throw new ConflictException({ code: "...", message: "..." })`.
- No money anywhere in this module. Meta's charge is not readable through the API.
- Backend has no ESLint config; `npm run typecheck` plus `npm run build` are its gates.
- Windows PowerShell: use `;` not `&&`. Write generated files with `[System.IO.File]::WriteAllLines(..., UTF8Encoding($false))` — `>` emits UTF-16.
- Frontend layering: `features/<x>` must not import another feature. Shared pure logic goes to `src/lib`.
- Conventional commits, one per task, issued from the workspace root.

---

### Task 1: Schema and migration `0011_campaigns`

**Files:**
- Modify: `Backend/prisma/schema.prisma` (append enums/models; add back-relations)
- Create: `Backend/prisma/migrations/0011_campaigns/migration.sql`

**Interfaces:**
- Produces: `Campaign`, `CampaignRecipient`, `CampaignStatus`, `RecipientStatus`, `Message.campaignId` for every later task.

- [ ] **Step 1: Add the enums and models**

Append to `schema.prisma`, and add `campaigns Campaign[]` to `model Workspace` and to `model MessageTemplate`, plus one column in `model Message`:

```prisma
enum CampaignStatus {
  DRAFT
  SCHEDULED
  RUNNING
  PAUSED
  COMPLETED
  CANCELLED
}

enum RecipientStatus {
  PENDING
  SENT
  FAILED
  SKIPPED
}

/// One broadcast: an approved template, a tag audience, and a schedule.
/// Counters are written only by `CampaignsRunner`, so they cannot disagree
/// with the recipient rows.
model Campaign {
  id               String           @id @default(uuid()) @db.Uuid
  workspaceId      String           @map("workspace_id") @db.Uuid
  name             String
  status           CampaignStatus   @default(DRAFT)
  templateId       String           @map("template_id") @db.Uuid
  /// Snapshot at create: the template row may be renamed or re-categorised.
  templateName     String           @map("template_name")
  templateLanguage String           @map("template_language")
  templateCategory TemplateCategory @map("template_category")
  audienceTags     String[]         @default([]) @map("audience_tags")
  variables        Json             @default("{}")
  buttonUrls       Json             @default("{}") @map("button_urls")
  optInConfirmed   Boolean          @default(false) @map("opt_in_confirmed")
  scheduledAt      DateTime?        @map("scheduled_at")
  startedAt        DateTime?        @map("started_at")
  completedAt      DateTime?        @map("completed_at")
  pausedAt         DateTime?        @map("paused_at")
  totalCount       Int              @default(0) @map("total_count")
  sentCount        Int              @default(0) @map("sent_count")
  failedCount      Int              @default(0) @map("failed_count")
  skippedCount     Int              @default(0) @map("skipped_count")
  createdByUserId  String?          @map("created_by_user_id") @db.Uuid
  createdAt        DateTime         @default(now()) @map("created_at")
  updatedAt        DateTime         @updatedAt @map("updated_at")

  workspace  Workspace           @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  template   MessageTemplate     @relation(fields: [templateId], references: [id])
  recipients CampaignRecipient[]

  @@index([workspaceId, createdAt])
  @@index([status, scheduledAt])
  @@map("campaigns")
}

/// One contact in one campaign. Delivery and read are NOT stored here — they
/// live on the `Message` row the webhook already advances.
model CampaignRecipient {
  id          String          @id @default(uuid()) @db.Uuid
  campaignId  String          @map("campaign_id") @db.Uuid
  contactId   String          @map("contact_id") @db.Uuid
  waId        String          @map("wa_id")
  status      RecipientStatus @default(PENDING)
  messageId   String?         @unique @map("message_id") @db.Uuid
  errorReason String?         @map("error_reason")
  attempts    Int             @default(0)
  claimedAt   DateTime?       @map("claimed_at")
  createdAt   DateTime        @default(now()) @map("created_at")
  updatedAt   DateTime        @updatedAt @map("updated_at")

  campaign Campaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)

  @@unique([campaignId, contactId])
  @@index([campaignId, status])
  @@map("campaign_recipients")
}
```

In `model Message`, after `payload`:

```prisma
  /// Set by the campaign runner. Null for every other send, which is what
  /// keeps campaign insights a single indexed groupBy.
  campaignId     String?          @map("campaign_id") @db.Uuid
```

and add `@@index([campaignId])` beside the model's existing indexes.

- [ ] **Step 2: Generate the SQL against the live database**

From `Backend`:

```powershell
node node_modules\prisma\build\index.js validate
$sql = node node_modules\prisma\build\index.js migrate diff --from-schema-datasource prisma\schema.prisma --to-schema-datamodel prisma\schema.prisma --script
New-Item -ItemType Directory -Force prisma\migrations\0011_campaigns | Out-Null
[System.IO.File]::WriteAllLines("$PWD\prisma\migrations\0011_campaigns\migration.sql", $sql, (New-Object System.Text.UTF8Encoding($false)))
```

- [ ] **Step 3: Read the generated SQL and confirm it is additive**

Open `prisma/migrations/0011_campaigns/migration.sql`. It must contain `CREATE TYPE "CampaignStatus"`, `CREATE TYPE "RecipientStatus"`, `CREATE TABLE "campaigns"`, `CREATE TABLE "campaign_recipients"`, and `ALTER TABLE "messages" ADD COLUMN "campaign_id"`. It must contain **no** `DROP`, no `ALTER COLUMN … SET NOT NULL` on an existing column, and no table rewrite.

- [ ] **Step 4: Apply, regenerate the client, type-check**

```powershell
node node_modules\prisma\build\index.js migrate deploy
node node_modules\prisma\build\index.js generate
npm run typecheck; Write-Output "TSC_EXIT=$LASTEXITCODE"
```

Expected: the migration is listed as applied, `TSC_EXIT=0`. If `generate` fails with `EPERM` on `query_engine-windows.dll.node`, a `nest start --watch` process holds the file — stop it, generate, restart.

- [ ] **Step 5: Commit**

```powershell
cd c:\Users\raman\Videos\Automation
git add Backend/prisma
git commit -m "feat(campaigns): add campaign and recipient schema with migration 0011"
```

---

### Task 2: Token bindings (pure module, probe-tested)

**Files:**
- Create: `Backend/src/campaigns/campaign.values.ts`

**Interfaces:**
- Produces:
  - `type TokenBinding = { kind: "static"; value: string } | { kind: "contact"; field: "name" | "waId"; fallback?: string }`
  - `type BindingMap = Record<string, TokenBinding>`
  - `bindingsOf(input: unknown): BindingMap`
  - `problemsInBindings(tokens: string[], bindings: BindingMap): string[]`
  - `resolveValues(bindings: BindingMap, contact: { profileName: string | null; waId: string }): Record<string, string>`

- [ ] **Step 1: Write the module**

```ts
/**
 * What a campaign fills a template's `{{token}}` with.
 *
 * Two kinds only: one value for everybody, or one field of the recipient. That
 * covers the greeting — the only per-recipient substitution a broadcast needs —
 * and keeps the stored JSON small enough to read in a psql session.
 */

export type TokenBinding =
  | { kind: "static"; value: string }
  | { kind: "contact"; field: "name" | "waId"; fallback?: string };

export type BindingMap = Record<string, TokenBinding>;

/** Tolerant parse: the column is JSON, and old rows may predate a field. */
export function bindingsOf(input: unknown): BindingMap {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {};
  }

  const out: BindingMap = {};

  for (const [token, raw] of Object.entries(input as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) continue;

    const entry = raw as Record<string, unknown>;

    if (entry.kind === "static" && typeof entry.value === "string") {
      out[token] = { kind: "static", value: entry.value };
      continue;
    }

    if (
      entry.kind === "contact" &&
      (entry.field === "name" || entry.field === "waId")
    ) {
      out[token] = {
        kind: "contact",
        field: entry.field,
        ...(typeof entry.fallback === "string" ? { fallback: entry.fallback } : {}),
      };
    }
  }

  return out;
}

/** Everything that would send an empty `{{n}}` to a customer. */
export function problemsInBindings(
  tokens: string[],
  bindings: BindingMap,
): string[] {
  const problems: string[] = [];

  for (const token of tokens) {
    const binding = bindings[token];

    if (!binding) {
      problems.push(`Choose a value for {{${token}}}.`);
      continue;
    }

    if (binding.kind === "static" && !binding.value.trim()) {
      problems.push(`Fill in {{${token}}}.`);
    }

    // A name is optional on every contact, and Meta rejects an empty
    // parameter, so the fallback is the only thing standing between a
    // nameless contact and a failed send.
    if (binding.kind === "contact" && binding.field === "name") {
      if (!binding.fallback?.trim()) {
        problems.push(`Give {{${token}}} a fallback for contacts with no saved name.`);
      }
    }
  }

  return problems;
}

/** One contact's values. Called once per recipient, before the send. */
export function resolveValues(
  bindings: BindingMap,
  contact: { profileName: string | null; waId: string },
): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [token, binding] of Object.entries(bindings)) {
    out[token] =
      binding.kind === "static"
        ? binding.value.trim()
        : binding.field === "waId"
          ? contact.waId
          : contact.profileName?.trim() || binding.fallback?.trim() || "";
  }

  return out;
}
```

- [ ] **Step 2: Build, then probe the compiled module**

```powershell
cd c:\Users\raman\Videos\Automation\Backend
npm run build; Write-Output "BUILD_EXIT=$LASTEXITCODE"
node -e "const v=require('./dist/campaigns/campaign.values.js');const b=v.bindingsOf({1:{kind:'contact',field:'name',fallback:'there'},2:{kind:'static',value:' 20% off '},3:{kind:'contact',field:'waId'},4:{kind:'bogus'}});console.log(JSON.stringify(b));console.log(JSON.stringify(v.resolveValues(b,{profileName:'Ritika',waId:'919000012345'})));console.log(JSON.stringify(v.resolveValues(b,{profileName:null,waId:'919000012345'})));console.log(v.problemsInBindings(['1','2','3','9'],b));console.log(v.problemsInBindings(['1','2'],v.bindingsOf({1:{kind:'contact',field:'name'},2:{kind:'static',value:'   '}})));"
```

Expected, in order: bindings keep only tokens 1–3 (`4` dropped); `{"1":"Ritika","2":"20% off","3":"919000012345"}`; `{"1":"there",…}`; `["Choose a value for {{9}}."]`; two problems — the missing fallback and the blank static value.

- [ ] **Step 3: Commit**

```powershell
git add Backend/src/campaigns/campaign.values.ts
git commit -m "feat(campaigns): add template token bindings with per-recipient resolution"
```

---

### Task 3: Module, options and audience endpoints

**Files:**
- Create: `Backend/src/campaigns/campaigns.module.ts`, `campaigns.controller.ts`, `campaigns.service.ts`, `campaigns.view.ts`, `dto/create-campaign.dto.ts`, `dto/update-campaign.dto.ts`, `dto/list-campaigns.dto.ts`, `dto/audience-query.dto.ts`, `dto/test-campaign.dto.ts`
- Modify: `Backend/src/app.module.ts`, `Backend/src/inbox/inbox.module.ts`

**Interfaces:**
- Consumes: Task 1's models, `shapeOf` from `../inbox/template-send`.
- Produces: `CampaignsService.options(claims)`, `.audience(claims, tags)`, and the module every later task adds methods to.

- [ ] **Step 1: Export the sender from the inbox**

In `inbox.module.ts`, change the exports line to:

```ts
  exports: [InboxStore, InboxSender, InboxGraph],
```

`InboxSender` owns the only code that turns a template into a Meta call; the campaign runner must not re-implement it.

- [ ] **Step 2: The controller shape**

```ts
@Controller("v1/campaigns")
@UseGuards(SupabaseAuthGuard)
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  /** GET /api/v1/campaigns — the list, newest first. */
  @Get()
  list(@CurrentUser() claims: AuthClaims, @Query() query: ListCampaignsDto) {
    return this.campaigns.list(claims, query);
  }

  /** GET /api/v1/campaigns/options — approved templates, tags, channel state. */
  @Get("options")
  options(@CurrentUser() claims: AuthClaims) {
    return this.campaigns.options(claims);
  }

  /** GET /api/v1/campaigns/audience?tags=a,b — the live matched count. */
  @Get("audience")
  audience(@CurrentUser() claims: AuthClaims, @Query() query: AudienceQueryDto) {
    return this.campaigns.audience(claims, query.tags ?? []);
  }
}
```

`options` and `audience` are declared before `:id` routes in the final file, because Nest matches in declaration order.

- [ ] **Step 3: Service workspace resolution and the two read endpoints**

```ts
@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async options(claims: AuthClaims) {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const [templates, tags, channel] = await Promise.all([
      this.prisma.messageTemplate.findMany({
        where: { workspaceId, status: "APPROVED" },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          name: true,
          language: true,
          category: true,
          components: true,
        },
      }),
      this.prisma.$queryRaw<{ tag: string }[]>`
        SELECT DISTINCT unnest(tags) AS tag
        FROM contacts
        WHERE workspace_id = ${workspaceId}::uuid
        ORDER BY tag
      `,
      this.prisma.whatsAppAccount.findUnique({
        where: { workspaceId },
        select: { displayName: true, phoneNumberId: true },
      }),
    ]);

    return {
      templates: templates.map((row) => ({
        id: row.id,
        name: row.name,
        language: row.language,
        category: row.category,
        shape: shapeOf(row.components),
      })),
      tags: tags.map((row) => row.tag),
      channel: channel
        ? { connected: true, display: channel.displayName, phoneNumberId: channel.phoneNumberId }
        : { connected: false, display: null, phoneNumberId: null },
    };
  }

  /** The audience, measured now — never cached, never the client's count. */
  async audience(claims: AuthClaims, tags: string[]) {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const where = audienceWhere(workspaceId, tags);

    const [total, sample] = await Promise.all([
      this.prisma.contact.count({ where }),
      this.prisma.contact.findMany({
        where,
        take: 5,
        orderBy: { createdAt: "asc" },
        select: { profileName: true, waId: true, phoneDisplay: true },
      }),
    ]);

    return { total, sample };
  }
}
```

with this helper at the bottom of the file:

```ts
/** Any-of tags; an empty list means the whole workspace. */
export function audienceWhere(workspaceId: string, tags: string[]) {
  return {
    workspaceId,
    ...(tags.length > 0 ? { tags: { hasSome: tags } } : {}),
  };
}
```

`WhatsAppAccount.displayName` — check the actual column name with `Select-String -Path prisma\schema.prisma -Pattern "model WhatsAppAccount" -Context 0,20` and use the real field; the inbox already reads it somewhere (`SEND_ACCOUNT_SELECT` does not include it, `connection()` does).

- [ ] **Step 4: DTOs**

```ts
// audience-query.dto.ts — comma-separated, deduplicated, trimmed.
export class AudienceQueryDto {
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === "string"
      ? [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))]
      : undefined,
  )
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
```

```ts
// list-campaigns.dto.ts
export class ListCampaignsDto {
  @IsOptional()
  @IsEnum(CampaignStatus)
  status?: CampaignStatus;
}
```

Create/update/test DTOs are written in Tasks 4 and 6.

- [ ] **Step 5: Register the module**

`campaigns.module.ts`:

```ts
@Module({
  imports: [AuthModule, WorkspacesModule, InboxModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
})
export class CampaignsModule {}
```

Add `CampaignsModule` to `app.module.ts`'s imports after `InboxModule`.

- [ ] **Step 6: Verify the routes are mapped**

```powershell
npm run typecheck; Write-Output "TSC_EXIT=$LASTEXITCODE"
npm run build; Write-Output "BUILD_EXIT=$LASTEXITCODE"
Select-String -Path dist\campaigns\campaigns.controller.js -Pattern "v1/campaigns|options|audience" | ForEach-Object { $_.Line.Trim() }
```

Expected: both exit codes 0, and the three paths present in `dist`. With the API running, `Invoke-WebRequest http://localhost:3001/api/v1/campaigns/options` must answer **401** — proof the route is mounted and the guard is active (an unmounted route answers 404).

- [ ] **Step 7: Commit**

```powershell
git add Backend/src
git commit -m "feat(campaigns): add campaigns module with template options and audience count"
```

---

### Task 4: Create, list, detail, edit, delete

**Files:**
- Modify: `Backend/src/campaigns/campaigns.service.ts`, `campaigns.controller.ts`
- Create: `Backend/src/campaigns/campaigns.view.ts`, `dto/create-campaign.dto.ts`, `dto/update-campaign.dto.ts`

**Interfaces:**
- Consumes: `bindingsOf`, `problemsInBindings` (Task 2); `shapeOf`, `problemsIn` (inbox).
- Produces: `CampaignsService.create/list/detail/update/remove`, and `CampaignView` consumed by every frontend task.

- [ ] **Step 1: The view**

```ts
export interface CampaignView {
  id: string;
  name: string;
  status: CampaignStatus;
  template: { id: string; name: string; language: string; category: TemplateCategory };
  audienceTags: string[];
  variables: BindingMap;
  buttonUrls: Record<string, string>;
  optInConfirmed: boolean;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  counts: { total: number; sent: number; failed: number; skipped: number };
  insights: Record<string, number>;   // MessageStatus -> count
  createdAt: string;
}
```

`insights` is built from `Message.groupBy({ by: ["status"], where: { campaignId } })` and always contains all five statuses (`QUEUED SENT DELIVERED READ FAILED`) with zeros filled in, so the UI never has to guard.

- [ ] **Step 2: Create**

```ts
async create(claims: AuthClaims, dto: CreateCampaignDto): Promise<{ campaign: CampaignView }> {
  const { workspaceId } = await this.workspaces.primaryFor(claims);

  const template = await this.prisma.messageTemplate.findFirst({
    where: { id: dto.templateId, workspaceId },
    select: {
      id: true, name: true, language: true, category: true,
      status: true, parameterFormat: true, components: true,
    },
  });

  if (!template) throw new NotFoundException("That template does not exist.");

  if (template.status !== "APPROVED") {
    throw new ConflictException({
      code: "TEMPLATE_NOT_APPROVED",
      message: `“${template.name}” is not approved yet, so it cannot be sent.`,
    });
  }

  const shape = shapeOf(template.components);
  const bindings = bindingsOf(dto.variables);

  const problems = [
    ...problemsInBindings(shape.tokens, bindings),
    ...problemsIn({
      shape,
      format: template.parameterFormat,
      values: placeholderValues(shape.tokens),
      buttonUrls: dto.buttonUrls ?? {},
      tapTarget: null,
    }).filter((problem) => problem.includes("button")),
  ];

  if (problems.length > 0) {
    throw new BadRequestException({ code: "TEMPLATE_VARIABLES_INVALID", message: problems });
  }

  if (template.category === "MARKETING" && dto.optInConfirmed !== true) {
    throw new BadRequestException({
      code: "OPT_IN_REQUIRED",
      message: "Confirm that these contacts agreed to receive marketing messages.",
    });
  }

  const row = await this.prisma.campaign.create({
    data: {
      workspaceId,
      name: dto.name,
      templateId: template.id,
      templateName: template.name,
      templateLanguage: template.language,
      templateCategory: template.category,
      audienceTags: dto.audienceTags ?? [],
      variables: bindings as unknown as Prisma.InputJsonValue,
      buttonUrls: (dto.buttonUrls ?? {}) as Prisma.InputJsonValue,
      optInConfirmed: dto.optInConfirmed ?? false,
      ...(dto.scheduledAt ? { scheduledAt: new Date(dto.scheduledAt), status: "SCHEDULED" } : {}),
    },
    select: CAMPAIGN_SELECT,
  });

  return { campaign: campaignView(row, {}) };
}
```

`placeholderValues(tokens)` returns `Object.fromEntries(tokens.map((t) => [t, "x"]))` — it exists only so `problemsIn` can be asked about the *buttons* without complaining about tokens that the bindings will fill at send time. Filtering on `problem.includes("button")` is deliberate: the token complaints come from `problemsInBindings`, which understands bindings.

- [ ] **Step 3: List and detail**

```ts
async list(claims: AuthClaims, query: ListCampaignsDto) {
  const { workspaceId } = await this.workspaces.primaryFor(claims);

  const rows = await this.prisma.campaign.findMany({
    where: { workspaceId, ...(query.status ? { status: query.status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: CAMPAIGN_SELECT,
  });

  // One aggregation for the whole page instead of one per row.
  const buckets = await this.prisma.message.groupBy({
    by: ["campaignId", "status"],
    where: { campaignId: { in: rows.map((row) => row.id) } },
    _count: { _all: true },
  });

  const byCampaign = new Map<string, Record<string, number>>();
  for (const bucket of buckets) {
    if (!bucket.campaignId) continue;
    const target = byCampaign.get(bucket.campaignId) ?? {};
    target[bucket.status] = bucket._count._all;
    byCampaign.set(bucket.campaignId, target);
  }

  return { campaigns: rows.map((row) => campaignView(row, byCampaign.get(row.id) ?? {})) };
}
```

`detail` returns `{ campaign, recipients: { items, nextCursor } }` with the first 50 recipients ordered by `createdAt asc`, and is the only place the recipient-level `errorReason` is exposed.

- [ ] **Step 4: Edit and delete, drafts only**

```ts
private async mustEditable(workspaceId: string, id: string) {
  const row = await this.prisma.campaign.findFirst({ where: { id, workspaceId }, select: { status: true } });
  if (!row) throw new NotFoundException("That campaign does not exist.");
  if (row.status !== "DRAFT" && row.status !== "SCHEDULED") {
    throw new ConflictException({
      code: "CAMPAIGN_LOCKED",
      message: "A campaign that has started cannot be edited. Pause or cancel it instead.",
    });
  }
  return row;
}
```

`update` accepts name, audienceTags, variables, buttonUrls, scheduledAt; changing `scheduledAt` from null to a date sets `SCHEDULED`, removing it sets `DRAFT`. `remove` calls `mustEditable`, then deletes (recipients cascade; a started campaign has none because recipients are materialised at start).

- [ ] **Step 5: Verify**

```powershell
npm run typecheck; Write-Output "TSC_EXIT=$LASTEXITCODE"
npm run build; Write-Output "BUILD_EXIT=$LASTEXITCODE"
```

Both 0. Then start the API and confirm `POST /api/v1/campaigns` answers 401 without a token (mounted + guarded) and that a hand-called `GET /api/v1/campaigns` with a token returns `{ campaigns: [] }`.

- [ ] **Step 6: Commit**

```powershell
git add Backend/src
git commit -m "feat(campaigns): add create, list, detail, edit and delete endpoints"
```

---

### Task 5: Delivery helper and the runner

**Files:**
- Create: `Backend/src/campaigns/campaigns.delivery.ts`, `Backend/src/campaigns/campaigns.runner.ts`, `Backend/src/config/campaigns.ts` (or read the two numbers from `ConfigService` with defaults — either is fine, but pick one and state it in the file header)
- Modify: `Backend/src/campaigns/campaigns.service.ts` (start/pause/resume/cancel), `campaigns.controller.ts`, `campaigns.module.ts`

**Interfaces:**
- Consumes: `InboxSender.template`, `shapeOf`, `resolveValues`.
- Produces: `Deliverer.send({ campaign, recipient, account }): Promise<{ messageId: string }>` and `CampaignsRunner.tick()`.

- [ ] **Step 1: One recipient's send, in one place**

```ts
@Injectable()
export class Deliverer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: InboxSender,
  ) {}

  /**
   * Contact → conversation → template. The conversation is created on demand:
   * a campaign is usually the first thing a business ever says to a contact,
   * so there is no thread to reuse.
   */
  async send(input: {
    campaign: CampaignSource;
    recipient: { contactId: string; waId: string; profileName: string | null };
    account: AccountCredentials;
  }): Promise<string> {
    const { campaign, recipient, account } = input;

    const contact = await this.prisma.contact.findUniqueOrThrow({
      where: { id: recipient.contactId },
      select: { id: true, profileName: true, waId: true },
    });

    const conversation = await this.prisma.conversation.upsert({
      where: { accountId_contactId: { accountId: account.id, contactId: contact.id } },
      create: {
        workspaceId: campaign.workspaceId,
        accountId: account.id,
        contactId: contact.id,
      },
      update: {},
      select: { id: true },
    });

    const values = resolveValues(bindingsOf(campaign.variables), contact);
    const shape = shapeOf(campaign.templateComponents);
    const built = buildMessage({
      shape,
      format: campaign.templateParameterFormat,
      values,
      buttonUrls: buttonUrlsOf(campaign.buttonUrls),
      tapTarget: null,
    });

    const message = await this.sender.template({
      workspaceId: campaign.workspaceId,
      conversationId: conversation.id,
      waId: contact.waId,
      account,
      name: campaign.templateName,
      language: campaign.templateLanguage,
      components: built.components,
      body: built.body,
      tapTarget: built.tapTarget,
      campaignId: campaign.id,
    });

    return message.id;
  }
}
```

`InboxSender.template` gains one optional field on its input (`campaignId?: string`) written into `message.create` as `...(input.campaignId ? { campaignId: input.campaignId } : {})` and returned untouched everywhere else. This is the only edit to existing inbox code, and it changes no behaviour for the inbox.

- [ ] **Step 2: The runner**

```ts
@Injectable()
export class CampaignsRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CampaignsRunner.name);
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  private readonly batch = 10;
  private readonly pauseMs = 2_000;   // 5 sends/second overall

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), 5_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass: claim what is due, then drain one batch from every running campaign. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;

    try {
      await this.service.claimDue();
      await this.service.releaseStale();

      for (const campaign of await this.service.running()) {
        await this.service.drain(campaign);
      }
    } catch (error) {
      this.logger.error(`Campaign tick failed: ${String(error)}`);
    } finally {
      this.busy = false;
    }
  }
}
```

- [ ] **Step 3: The service side of the loop**

```ts
/** SCHEDULED and due → RUNNING. One statement, so two loops cannot both win. */
async claimDue(): Promise<void> {
  const due = await this.prisma.campaign.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
    take: 3,
    select: { id: true },
  });

  for (const { id } of due) await this.begin(id);
}

/** The transition plus the audience snapshot. Idempotent by construction. */
async begin(id: string): Promise<void> {
  const claimed = await this.prisma.campaign.updateMany({
    where: { id, status: { in: ["DRAFT", "SCHEDULED"] } },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  if (claimed.count === 0) return;

  const campaign = await this.prisma.campaign.findUniqueOrThrow({
    where: { id },
    select: { workspaceId: true, audienceTags: true },
  });

  const contacts = await this.prisma.contact.findMany({
    where: audienceWhere(campaign.workspaceId, campaign.audienceTags),
    select: { id: true, waId: true },
  });

  if (contacts.length === 0) {
    await this.prisma.campaign.update({
      where: { id },
      data: { status: "COMPLETED", completedAt: new Date(), totalCount: 0 },
    });
    return;
  }

  await this.prisma.campaignRecipient.createMany({
    data: contacts.map((contact) => ({
      campaignId: id,
      contactId: contact.id,
      waId: contact.waId,
    })),
    skipDuplicates: true,
  });

  await this.prisma.campaign.update({ where: { id }, data: { totalCount: contacts.length } });
}

/** A batch that died mid-flight is offered again, capped at three attempts. */
async releaseStale(): Promise<void> {
  await this.prisma.campaignRecipient.updateMany({
    where: { status: "PENDING", claimedAt: { lt: new Date(Date.now() - 60_000) } },
    data: { claimedAt: null, attempts: { increment: 1 } },
  });
}

async drain(campaign: RunningCampaign): Promise<void> {
  const account = await this.accountFor(campaign.workspaceId);

  if (!account) {
    await this.stopForNoChannel(campaign.id);
    return;
  }

  const batch = await this.claimBatch(campaign.id);
  if (batch.length === 0) {
    const left = await this.prisma.campaignRecipient.count({
      where: { campaignId: campaign.id, status: "PENDING" },
    });
    if (left === 0) await this.finish(campaign.id);
    return;
  }

  let sent = 0;
  let failed = 0;

  for (const recipient of batch) {
    try {
      const messageId = await this.deliverer.send({ campaign, recipient, account });
      await this.prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "SENT", messageId, claimedAt: null, errorReason: null },
      });
      sent += 1;
    } catch (error) {
      await this.prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "FAILED", claimedAt: null, errorReason: reasonOf(error) },
      });
      failed += 1;
    }

    await sleep(this.pauseMs / this.batch);
  }

  await this.prisma.campaign.update({
    where: { id: campaign.id },
    data: { sentCount: { increment: sent }, failedCount: { increment: failed } },
  });
}
```

`claimBatch` selects up to 10 `PENDING` rows with `claimedAt: null` and `attempts < 3`, then marks them claimed in the same pass (`updateMany` on the ids, setting `claimedAt: new Date()`). `reasonOf(error)` reads `ApiError`-style Meta text — reuse the inbox's `toHttp` output when the caught value is an `HttpException`: `const response = error.getResponse(); typeof response === "object" ? JSON.stringify(response) : String(response)`.

`stopForNoChannel` sets the campaign `FAILED` and every `PENDING` recipient `SKIPPED` with reason "No WhatsApp number is connected."; `finish` sets `COMPLETED` + `completedAt`.

- [ ] **Step 4: Lifecycle routes**

`start` → `begin(id)` then re-read and return the view (409 `CAMPAIGN_LOCKED` when the status is not DRAFT/SCHEDULED). `pause` → `updateMany({ where: { id, status: "RUNNING" }, data: { status: "PAUSED", pausedAt: new Date() } })`, 409 when zero rows. `resume` → `PAUSED → RUNNING`, 409 otherwise. `cancel` → `updateMany` on DRAFT/SCHEDULED/RUNNING/PAUSED, then all `PENDING` recipients become `SKIPPED` and `skippedCount` is set to that count.

- [ ] **Step 5: Verify the loop without a live number**

```powershell
npm run typecheck; Write-Output "TSC_EXIT=$LASTEXITCODE"
npm run build; Write-Output "BUILD_EXIT=$LASTEXITCODE"
```

Then, against a workspace with no `WhatsAppAccount` (the current state of the dev database), `POST /campaigns/:id/start` followed by one tick must leave the campaign `FAILED` with every recipient `SKIPPED` — the `NO_CHANNEL` path, and proof the claim → materialise → drain chain runs. Check with:

```powershell
Select-String -Path dist\campaigns\campaigns.runner.js -Pattern "claimDue|releaseStale|drain" | ForEach-Object { $_.Line.Trim() }
```

- [ ] **Step 6: Commit**

```powershell
git add Backend/src
git commit -m "feat(campaigns): add recipient delivery and the in-process send runner"
```

---

### Task 6: Test send and CSV export

**Files:**
- Modify: `Backend/src/campaigns/campaigns.service.ts`, `campaigns.controller.ts`
- Create: `Backend/src/campaigns/dto/test-campaign.dto.ts`

**Interfaces:**
- Consumes: `Deliverer.send` — for the test it is called with a contact-bound recipient that has no `CampaignRecipient` row.

- [ ] **Step 1: Test send**

```ts
export class TestCampaignDto {
  /** Digits only, the way Meta names a customer. */
  @Transform(({ value }) => (typeof value === "string" ? value.replace(/\D/g, "") : value))
  @Matches(/^\d{6,15}$/, { message: "Give a WhatsApp number in international format." })
  to!: string;
}
```

```ts
async test(claims: AuthClaims, id: string, dto: TestCampaignDto) {
  const { workspaceId } = await this.workspaces.primaryFor(claims);
  const campaign = await this.campaignSource(workspaceId, id);
  const account = await this.accountFor(workspaceId);

  if (!account) {
    throw new ConflictException({ code: "NO_CHANNEL", message: "Connect a WhatsApp number before sending a test." });
  }

  // The test goes to a real thread, so the reply lands somewhere. The contact
  // row is created if this number has never written in.
  const contact = await this.prisma.contact.upsert({
    where: { workspaceId_waId: { workspaceId, waId: dto.to } },
    create: { workspaceId, waId: dto.to, profileName: "Test recipient" },
    update: {},
    select: { id: true, waId: true, profileName: true },
  });

  const messageId = await this.deliverer.send({
    campaign,
    recipient: { contactId: contact.id, waId: contact.waId, profileName: contact.profileName },
    account,
  });

  return { messageId };
}
```

The test send deliberately does **not** write `Message.campaignId`: a test is not a recipient, and counting it would make the insight strip lie.

- [ ] **Step 2: CSV**

```ts
@Get(":id/recipients.csv")
@Header("Content-Type", "text/csv; charset=utf-8")
@Header("Content-Disposition", 'attachment; filename="recipients.csv"')
async recipientsCsv(@CurrentUser() claims: AuthClaims, @Param("id", ParseUUIDPipe) id: string) {
  const csv = await this.campaigns.recipientsCsv(claims, id);
  return new StreamableFile(Buffer.from(csv, "utf8"));
}
```

The service builds rows from one query:

```ts
const rows = await this.prisma.campaignRecipient.findMany({
  where: { campaignId: id, campaign: { workspaceId } },
  orderBy: { createdAt: "asc" },
  select: {
    waId: true, status: true, errorReason: true,
    message: { select: { sentAt: true, deliveredAt: true, readAt: true } },
  },
});
```

Columns: `wa_id,status,error,sent_at,delivered_at,read_at`. `Message` needs a back-relation for this select — add `recipient CampaignRecipient?` to `model Message` and `message Message? @relation(fields:[messageId], references:[id])` on `CampaignRecipient`, then a second `migrate diff` into `0011_campaigns` is **not** acceptable; add it in Task 1 instead (see the note below).

- [ ] **Step 3: Verify**

```powershell
npm run typecheck; Write-Output "TSC_EXIT=$LASTEXITCODE"
npm run build; Write-Output "BUILD_EXIT=$LASTEXITCODE"
Select-String -Path dist\campaigns\campaigns.controller.js -Pattern "recipients.csv|test" | ForEach-Object { $_.Line.Trim() }
```

- [ ] **Step 4: Commit**

```powershell
git add Backend/src
git commit -m "feat(campaigns): add test send and recipient CSV export"
```

---

### Task 7: Shared template shape and the campaign API client

**Files:**
- Create: `frontend/src/lib/templates/shape.ts` (moved), `frontend/src/features/campaigns/api.ts`
- Delete: `frontend/src/features/inbox/template-shape.ts`
- Modify: `frontend/src/features/inbox/components/template-panel.tsx:16`

**Interfaces:**
- Produces: `shapeOf`, `readable`, `TemplateShape` from `@/lib/templates/shape`; and the campaign client types every UI task uses.

- [ ] **Step 1: Move the parser**

```powershell
cd c:\Users\raman\Videos\Automation\frontend
New-Item -ItemType Directory -Force src\lib\templates | Out-Null
git mv src\features\inbox\template-shape.ts src\lib\templates\shape.ts
```

Change `template-panel.tsx`'s import to `import { readable, shapeOf } from "@/lib/templates/shape";` and leave the file's contents otherwise untouched. Verify nothing else imported it:

```powershell
Select-String -Path src -Pattern "template-shape" -Recurse | ForEach-Object { $_.Path }
```

Expect no output.

- [ ] **Step 2: The client types**

```ts
export type CampaignStatus = "DRAFT" | "SCHEDULED" | "RUNNING" | "PAUSED" | "COMPLETED" | "CANCELLED";
export type RecipientStatus = "PENDING" | "SENT" | "FAILED" | "SKIPPED";

export type TokenBinding =
  | { kind: "static"; value: string }
  | { kind: "contact"; field: "name" | "waId"; fallback?: string };

export interface CampaignInsights {
  QUEUED: number; SENT: number; DELIVERED: number; READ: number; FAILED: number;
}

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  template: { id: string; name: string; language: string; category: string };
  audienceTags: string[];
  variables: Record<string, TokenBinding>;
  buttonUrls: Record<string, string>;
  optInConfirmed: boolean;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  counts: { total: number; sent: number; failed: number; skipped: number };
  insights: CampaignInsights;
  createdAt: string;
}

export interface CampaignOptions {
  templates: { id: string; name: string; language: string; category: string; shape: TemplateShape }[];
  tags: string[];
  channel: { connected: boolean; display: string | null; phoneNumberId: string | null };
}

export interface Recipient {
  id: string;
  waId: string;
  contactName: string | null;
  status: RecipientStatus;
  errorReason: string | null;
  deliveredAt: string | null;
  readAt: string | null;
}
```

Functions, all through `lib/api/http.ts` (`http.get/post/patch/del` — confirm the helper's exported names with `Select-String -Path src\lib\api\http.ts -Pattern "export"`): `fetchCampaigns(status?)`, `fetchCampaign(id)`, `fetchCampaignOptions()`, `fetchAudience(tags)`, `createCampaign(input)`, `updateCampaign(id, input)`, `deleteCampaign(id)`, `startCampaign(id)`, `pauseCampaign(id)`, `resumeCampaign(id)`, `cancelCampaign(id)`, `testCampaign(id, to)`.

- [ ] **Step 3: Verify**

```powershell
npx tsc --noEmit; Write-Output "TSC_EXIT=$LASTEXITCODE"
npx eslint src --max-warnings=0; Write-Output "LINT_EXIT=$LASTEXITCODE"
```

- [ ] **Step 4: Commit**

```powershell
cd c:\Users\raman\Videos\Automation
git add frontend/src
git commit -m "feat(campaigns): add campaign API client and share the template shape parser"
```

---

### Task 8: Campaigns list and the create panel

**Files:**
- Create: `frontend/src/features/campaigns/components/campaigns-view.tsx`, `campaign-form.tsx`, `campaign-preview.tsx`
- Modify: `frontend/src/app/(app)/workspace/campaigns/page.tsx`

**Interfaces:**
- Consumes: Task 7's client.
- Produces: `<CampaignsView />`, and `CampaignPreview({ shape, bindings })` reused by Task 9's detail header.

- [ ] **Step 1: The page shell**

The route keeps its `metadata` and drops `PlannedCapabilities`:

```tsx
export const metadata: Metadata = { title: nav.title };

export default function CampaignsPage() {
  return <CampaignsView />;
}
```

- [ ] **Step 2: The list**

`CampaignsView` is a client component that fetches on mount and renders:

- A header row: "New campaign" button (disabled with a reason when `options.channel.connected` is false or `options.templates.length === 0`), and a status filter built from the six statuses plus "All".
- `DataTable` with columns `Campaign · Template · Audience · Status · Sent · Delivered · Read · Schedule`. Cells: name (link to `/workspace/campaigns/{id}`), `template.name` with its category as a subtitle, `audienceTags.join(", ")` or "Everyone", a status pill, and the three insights numbers from `campaign.insights` (`SENT`, `DELIVERED`, `READ`).
- Empty state: "No campaigns yet" with the button in the description.
- A line under the title: "AOTMS campaigns are sent through the WhatsApp Cloud API. Meta's Business Suite campaigns are a separate tool with no API, so they never appear here."

Loading, error and empty are three separate states, like `templates-view.tsx`.

- [ ] **Step 3: The form**

`CampaignForm` is a `Dialog` (the same primitive `templates-view.tsx` uses for its create panel) with six blocks in this order: name · template (searchable list of `options.templates`, showing `category`) · audience (tag chips from `options.tags` plus an "Everyone" chip; a debounced `fetchAudience(tags)` shows "Sending to N contacts" with five names) · values (one row per `shape.tokens`, with a "Use a contact field" switch that turns the row into `contact.name` + required fallback, or `contact.waId`) · schedule (a `datetime-local` input, optional) · review (marketing opt-in checkbox, the preview, and submit).

Rules enforced in the form, matching the server: submit disabled until name, template and every token are bound; the opt-in checkbox is only shown for `category === "MARKETING"` and is required there; the button says "Schedule campaign" when a date is set and "Save draft" otherwise.

- [ ] **Step 4: The preview**

`CampaignPreview` renders the bubble the recipients will read, using `readable(shape, exampleValues)` where `exampleValues` fills static bindings with their text and contact bindings with the fallback (or `profileName` sample). Header, body, footer and URL buttons are drawn at WhatsApp scale, no phone chrome — the Templates module already owns that mockup.

- [ ] **Step 5: Verify**

```powershell
npx tsc --noEmit; Write-Output "TSC_EXIT=$LASTEXITCODE"
npx eslint src --max-warnings=0; Write-Output "LINT_EXIT=$LASTEXITCODE"
```

- [ ] **Step 6: Commit**

```powershell
git add frontend/src
git commit -m "feat(campaigns): add campaign list and the create panel"
```

---

### Task 9: Campaign detail

**Files:**
- Create: `frontend/src/features/campaigns/components/campaign-detail.tsx`
- Create: `frontend/src/app/(app)/workspace/campaigns/[id]/page.tsx`

**Interfaces:**
- Consumes: `fetchCampaign`, `CampaignPreview`, the lifecycle functions.

- [ ] **Step 1: The route**

Copy the shape of `templates/[id]/page.tsx` exactly: `export const instant = false;`, `params: Promise<{ id: string }>`, and `<CampaignDetail id={id} />`.

- [ ] **Step 2: The screen**

- Header: name, status pill, and the actions the status allows — DRAFT/SCHEDULED → Start, Edit, Delete; RUNNING → Pause, Cancel; PAUSED → Resume, Cancel; COMPLETED/CANCELLED/FAILED → none. Each action calls its function, replaces the campaign from the response, and surfaces `ApiError.code` text (e.g. `OPT_IN_REQUIRED`).
- Progress bar: `counts.sent + counts.failed` of `counts.total`, with "N of M contacts".
- Insights strip: Total, Sent, Delivered, Read, Failed from `campaign.insights`, plus one line: "Meta bills each delivered message at its own rate; that charge is not available through the API, so it is not shown here."
- Recipients table: `wa_id`, name, status, failure reason, delivered, read. First 50 with a "Load more" using the cursor.
- "Download CSV" link to `/api/v1/campaigns/{id}/recipients.csv` through the same authorised fetch, saved as a blob.
- Poll every 3 s while `status === "RUNNING"` — the inbox thread's pattern, same interval constant.

- [ ] **Step 3: Verify**

```powershell
npx tsc --noEmit; Write-Output "TSC_EXIT=$LASTEXITCODE"
npx eslint src --max-warnings=0; Write-Output "LINT_EXIT=$LASTEXITCODE"
npm run build; Write-Output "BUILD_EXIT=$LASTEXITCODE"
```

Expected: all 0, and the build output lists `/workspace/campaigns` and `/workspace/campaigns/[id]`.

- [ ] **Step 4: Commit**

```powershell
git add frontend/src
git commit -m "feat(campaigns): add campaign detail with insights, recipients and export"
```

---

### Task 10: End-to-end verification and cleanup

**Files:**
- Create then delete: `frontend/src/app/campaigncheck/page.tsx` (+ `campaign-fixture.tsx`)
- Modify: whatever the pass finds

- [ ] **Step 1: Static gates**

```powershell
cd c:\Users\raman\Videos\Automation\Backend; npm run typecheck; npm run build
cd ..\frontend; npx tsc --noEmit; npx eslint src --max-warnings=0; npm run build
```

All four clean. Record the build's route table — both campaign routes present.

- [ ] **Step 2: Browser pass on a fixture route**

Build a throwaway route that mounts `ToastProvider` and renders `CampaignsView` with mocked `fetch` returning three campaigns (draft, running with partial counts, completed) and then `CampaignDetail` for each status. Client-only via `next/dynamic({ ssr: false })`, fixed ISO timestamps, no `Date.now()` — the hydration mistakes from the inbox pass are already known.

Check at **1440 and 390**: every status renders its correct action set; the insights strip shows zeros rather than blanks; the recipients table scrolls horizontally instead of overflowing the card; the create panel's token rows switch between static and contact binding; no horizontal page scroll (`document.documentElement.scrollWidth === innerWidth`). Fix anything found, then delete the route and confirm `Select-String -Path src -Pattern "campaigncheck" -Recurse` is empty.

- [ ] **Step 3: Engine check against the database**

With the API running, drive one campaign through the real endpoints: create a draft with `audienceTags: []` on a workspace holding two contacts and no connected number → `start` → after one tick the campaign is `FAILED` and both recipients are `SKIPPED` with the no-channel reason → `start` again answers 409 `CAMPAIGN_LOCKED`. Then `DELETE` a draft and confirm 200; `DELETE` the failed one and confirm 409.

- [ ] **Step 4: Commit**

```powershell
git add -A frontend/src Backend/src
git commit -m "test(campaigns): verify screens at 1440 and 390 and the engine lifecycle"
```

---

## Notes for whoever executes this

- **Add the `Message` ↔ `CampaignRecipient` relation in Task 1, not Task 6.** Task 6's CSV select depends on `message` being a relation on `CampaignRecipient`; discovering that late means a second migration. Include it in the first schema edit.
- `WhatsAppAccount`'s display column name must be read from the schema before writing `options()`; the inbox reads it under a different select name than `SEND_ACCOUNT_SELECT`.
- The frontend `http` helper's exact method names must be read before the api client is written; do not assume `http.patch` exists under that name.
- `campaignView` is the single place that maps a row plus an insights bucket to the JSON the UI consumes; every endpoint returns campaigns through it.
- Nothing in this module may say a campaign is "free" or show a currency amount.
