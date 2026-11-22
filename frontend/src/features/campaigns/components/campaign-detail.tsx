"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Download,
  Loader2,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { DataTable } from "@/components/workspace/data-table";
import { PageHeader } from "@/components/workspace/page-header";
import { cn } from "@/lib/utils";

import {
  ApiError,
  cancelCampaign,
  deleteCampaign,
  fetchCampaign,
  fetchCampaignOptions,
  fetchRecipientsCsv,
  pauseCampaign,
  resumeCampaign,
  startCampaign,
  testCampaign,
  type Campaign,
  type CampaignDetail as CampaignPayload,
  type CampaignOptions,
  type Recipient,
} from "../api";
import { CampaignForm } from "./campaign-form";
import { StatusPill } from "./status-pill";

/** The same interval the Inbox thread polls at while a send is in flight. */
const POLL_MS = 3_000;

const RECIPIENT_COLUMNS = [
  { key: "wa_id", label: "Number" },
  { key: "name", label: "Name" },
  { key: "status", label: "Send" },
  { key: "reason", label: "Reason" },
  { key: "delivered", label: "Delivered" },
  { key: "read", label: "Read" },
];

const FIELD =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-[13.5px] text-foreground shadow-xs outline-none transition-shadow placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px]";

/**
 * One campaign.
 *
 * Delivery and read come from the messages the webhook has updated, so this
 * screen is a view of what Meta confirmed, not of what AOTMS hoped. While the
 * campaign is running it re-reads every three seconds rather than pretending a
 * progress bar is live when it is a snapshot.
 */
export function CampaignDetail({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const [campaign, setCampaign] = React.useState<Campaign | null>(null);
  const [recipients, setRecipients] = React.useState<Recipient[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const cursorRef = React.useRef<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const [editing, setEditing] = React.useState(false);
  const [options, setOptions] = React.useState<CampaignOptions | null>(null);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testTo, setTestTo] = React.useState("");
  const [loadingMore, setLoadingMore] = React.useState(false);

  function apply(payload: CampaignPayload) {
    setCampaign(payload.campaign);
    // A campaign that started has new rows at the top; replacing the first
    // page keeps the order the server sorts by.
    setRecipients((current) =>
      cursorRef.current === null ? payload.recipients.items : current,
    );

    if (cursorRef.current === null) {
      cursorRef.current = payload.recipients.nextCursor;
      setCursor(payload.recipients.nextCursor);
    }
  }

  React.useEffect(() => {
    let active = true;

    fetchCampaign(id)
      .then((payload) => {
        if (active) apply(payload);
      })
      .catch((caught: unknown) => {
        if (active) setError(readError(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
    // `apply` reads only refs and setters, so the id and the retry are the
    // whole dependency set.
  }, [id, attempt]);

  const status = campaign?.status ?? null;

  React.useEffect(() => {
    if (status !== "RUNNING") return;

    const timer = setInterval(() => {
      fetchCampaign(id)
        .then(apply)
        .catch(() => {
          // A failed poll keeps the last confirmed numbers on screen; the next
          // one either succeeds or the screen still shows what it knew.
        });
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [id, status]);

  async function act(
    label: string,
    run: () => Promise<CampaignPayload>,
    done: string,
  ) {
    setBusy(label);
    setError(null);

    try {
      apply(await run());
      toast.push({ title: done, tone: "success" });
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function loadMore() {
    if (!cursor) return;

    setLoadingMore(true);

    try {
      const next = await fetchCampaign(id, cursor);
      setRecipients((current) => [...current, ...next.recipients.items]);
      cursorRef.current = next.recipients.nextCursor;
      setCursor(next.recipients.nextCursor);
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setLoadingMore(false);
    }
  }

  async function openEditor() {
    setError(null);

    try {
      const next = options ?? (await fetchCampaignOptions());
      setOptions(next);
      setEditing(true);
    } catch (caught) {
      setError(readError(caught));
    }
  }

  async function removeCampaign() {
    setBusy("delete");
    setError(null);

    try {
      await deleteCampaign(id);
      toast.push({ title: "The draft is deleted.", tone: "success" });
      router.push("/workspace/campaigns");
    } catch (caught) {
      setError(readError(caught));
      setBusy(null);
      setConfirmingDelete(false);
    }
  }

  async function sendTest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const digits = testTo.replace(/\D/g, "");

    if (digits.length < 6) return;

    setBusy("test");
    setError(null);

    try {
      await testCampaign(id, digits);
      toast.push({
        title: `A test is on its way to ${digits}.`,
        description: "It arrives in the Inbox as its own thread.",
        tone: "success",
      });
      setTesting(false);
      setTestTo("");
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function downloadCsv() {
    if (!campaign) return;

    setBusy("csv");
    setError(null);

    try {
      const blob = await fetchRecipientsCsv(campaign.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = `${slugOf(campaign.name)}-recipients.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setBusy(null);
    }
  }

  if (loading && !campaign) {
    return (
      <div className="grid h-64 place-items-center rounded-xl border border-border bg-card">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold text-foreground">
          The campaign could not be read
        </h2>
        <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
          {error ?? "That campaign does not exist, or it belongs to another workspace."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            onClick={() => {
              setLoading(true);
              setError(null);
              setAttempt((count) => count + 1);
            }}
            type="button"
            variant="outline"
          >
            <RefreshCw />
            Try again
          </Button>
          <Button asChild variant="ghost">
            <Link href="/workspace/campaigns">Back to campaigns</Link>
          </Button>
        </div>
      </div>
    );
  }

  const settled =
    campaign.counts.sent + campaign.counts.failed + campaign.counts.skipped;
  const percent =
    campaign.counts.total === 0
      ? 0
      : Math.min(100, Math.round((settled / campaign.counts.total) * 100));

  const editable = campaign.status === "DRAFT" || campaign.status === "SCHEDULED";

  return (
    <div className="space-y-5">
      <Link
        className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
        href="/workspace/campaigns"
      >
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        All campaigns
      </Link>

      <PageHeader
        actions={
          <>
            {campaign.status === "RUNNING" ? (
              <Button
                disabled={busy !== null}
                onClick={() =>
                  act(
                    "pause",
                    () => pauseCampaign(campaign.id),
                    "The campaign is paused. Nothing new is sent until it resumes.",
                  )
                }
                type="button"
                variant="outline"
              >
                <Pause />
                Pause
              </Button>
            ) : null}

            {campaign.status === "PAUSED" ? (
              <Button
                disabled={busy !== null}
                onClick={() =>
                  act(
                    "resume",
                    () => resumeCampaign(campaign.id),
                    "The campaign is running again.",
                  )
                }
                type="button"
                variant="outline"
              >
                <Play />
                Resume
              </Button>
            ) : null}

            {editable ? (
              <>
                <Button
                  disabled={busy !== null}
                  onClick={() =>
                    act(
                      "start",
                      () => startCampaign(campaign.id),
                      "The campaign started. Recipients are sent in order.",
                    )
                  }
                  type="button"
                  variant="brand"
                >
                  <Play />
                  Start now
                </Button>

                <Button
                  disabled={busy !== null}
                  onClick={openEditor}
                  type="button"
                  variant="outline"
                >
                  <Pencil />
                  Edit
                </Button>

                <Button
                  disabled={busy !== null}
                  onClick={() => setConfirmingDelete(true)}
                  type="button"
                  variant="ghost"
                >
                  <Trash2 />
                  Delete
                </Button>
              </>
            ) : null}

            {campaign.status === "RUNNING" || campaign.status === "PAUSED" ? (
              <Button
                disabled={busy !== null}
                onClick={() =>
                  act(
                    "cancel",
                    () => cancelCampaign(campaign.id),
                    "The campaign is cancelled. The rest of the audience is skipped.",
                  )
                }
                type="button"
                variant="ghost"
              >
                <XCircle />
                Cancel
              </Button>
            ) : null}

            <Button
              disabled={busy !== null}
              onClick={() => setTesting((open) => !open)}
              type="button"
              variant="outline"
            >
              <Send />
              Send a test
            </Button>

            <Button
              disabled={busy !== null}
              onClick={downloadCsv}
              type="button"
              variant="outline"
            >
              {busy === "csv" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Download />
              )}
              CSV
            </Button>
          </>
        }
        description={`${campaign.template.category.toLowerCase()} template · ${campaign.template.name} · ${campaign.template.language}`}
        eyebrow="Campaign"
        title={campaign.name}
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={campaign.status} />
        <span className="text-[12.5px] text-muted-foreground">
          {campaign.audienceTags.length > 0
            ? `Audience: ${campaign.audienceTags.join(", ")}`
            : "Audience: everyone"}
        </span>
        <span className="text-[12.5px] text-muted-foreground">
          · {whenOf(campaign)}
        </span>
      </div>

      {confirmingDelete ? (
        <div className="rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2.5">
          <p className="text-[12.5px] leading-relaxed text-foreground">
            Delete “{campaign.name}”? It has not been sent, so there is no
            history to keep. This cannot be undone.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              disabled={busy !== null}
              onClick={removeCampaign}
              size="sm"
              type="button"
              variant="destructive"
            >
              {busy === "delete" ? <Loader2 className="animate-spin" /> : null}
              Delete the draft
            </Button>
            <Button
              onClick={() => setConfirmingDelete(false)}
              size="sm"
              type="button"
              variant="ghost"
            >
              Keep it
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p
          className="rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2 text-[12.5px] leading-relaxed text-foreground"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {testing ? (
        <form
          className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-3"
          onSubmit={sendTest}
        >
          <div className="min-w-48 flex-1 space-y-1">
            <Label htmlFor="campaign-test-number">Send a test to</Label>
            <input
              className={FIELD}
              id="campaign-test-number"
              inputMode="tel"
              onChange={(event) => setTestTo(event.target.value)}
              placeholder="919876543210"
              value={testTo}
            />
          </div>
          <Button
            disabled={busy !== null || testTo.replace(/\D/g, "").length < 6}
            type="submit"
            variant="brand"
          >
            {busy === "test" ? <Loader2 className="animate-spin" /> : <Send />}
            Send test
          </Button>
          <Button
            onClick={() => setTesting(false)}
            type="button"
            variant="ghost"
          >
            Close
          </Button>
          <p className="w-full text-[11.5px] leading-relaxed text-muted-foreground">
            A test is one real message with these values filled from the
            recipient. It is not part of the audience and is not counted.
          </p>
        </form>
      ) : null}

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Progress</h2>
          <p className="text-[12.5px] tabular-nums text-muted-foreground">
            {settled} of {campaign.counts.total} contacts ·{" "}
            {campaign.counts.skipped} skipped
          </p>
        </div>

        <div
          aria-label="Contacts handled"
          aria-valuemax={campaign.counts.total}
          aria-valuemin={0}
          aria-valuenow={settled}
          className="mt-2 h-2 overflow-hidden rounded-full bg-secondary"
          role="progressbar"
        >
          <div
            className="h-full rounded-full bg-whatsapp transition-[width] duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
      </section>

      <section>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <InsightCell label="Total" value={campaign.counts.total} />
          <InsightCell label="Sent" value={campaign.insights.SENT} />
          <InsightCell
            label="Delivered"
            value={campaign.insights.DELIVERED}
          />
          <InsightCell label="Read" value={campaign.insights.READ} />
          <InsightCell label="Failed" value={campaign.insights.FAILED} />
        </dl>

        <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
          Meta bills each delivered message at its own rate. That charge is not
          available through the API, so it is not shown here — and no campaign
          is ever described as free.
        </p>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Recipients</h2>
          <p className="text-[12px] text-muted-foreground">
            Delivery and read are the message&apos;s own status, as Meta reported
            it.
          </p>
        </div>

        <DataTable
          columns={RECIPIENT_COLUMNS}
          empty={
            <p className="text-center text-[12.5px] leading-relaxed text-muted-foreground">
              {campaign.status === "DRAFT" || campaign.status === "SCHEDULED"
                ? "The audience is written when the campaign starts, so this list is empty until then."
                : "No recipient was written for this campaign."}
            </p>
          }
          rows={recipients.map((recipient) => [
            <span
              className="block font-mono text-[12.5px] whitespace-nowrap text-foreground"
              key="wa_id"
            >
              {recipient.waId}
            </span>,
            <span className="block max-w-40 truncate text-[13px]" key="name">
              {recipient.contactName ?? "—"}
            </span>,
            <span
              className={cn(
                "inline-flex rounded-full border px-2 py-0.5 text-[11.5px] font-medium",
                recipient.status === "FAILED"
                  ? "border-destructive/40 bg-destructive/5 text-foreground"
                  : recipient.status === "SENT"
                    ? "border-whatsapp/40 bg-whatsapp/10 text-foreground"
                    : "border-border bg-secondary text-muted-foreground",
              )}
              key="status"
            >
              {recipientLabel(recipient)}
            </span>,
            <span
              className="line-clamp-2 max-w-56 text-[12px] leading-relaxed text-muted-foreground sm:line-clamp-none"
              key="reason"
              title={recipient.errorReason ?? undefined}
            >
              {recipient.errorReason ?? "—"}
            </span>,
            <span
              className="block text-[12px] whitespace-nowrap text-muted-foreground"
              key="delivered"
            >
              {clockOf(recipient.deliveredAt)}
            </span>,
            <span
              className="block text-[12px] whitespace-nowrap text-muted-foreground"
              key="read"
            >
              {clockOf(recipient.readAt)}
            </span>,
          ])}
        />

        {cursor ? (
          <div className="flex justify-center">
            <Button
              disabled={loadingMore}
              onClick={loadMore}
              type="button"
              variant="outline"
            >
              {loadingMore ? <Loader2 className="animate-spin" /> : null}
              Load more
            </Button>
          </div>
        ) : null}
      </section>

      {editing && options ? (
        <CampaignForm
          editing={campaign}
          onClose={() => setEditing(false)}
          onSaved={(next) => {
            setEditing(false);
            setCampaign(next);
            toast.push({ title: "The campaign is updated.", tone: "success" });
          }}
          options={options}
        />
      ) : null}
    </div>
  );
}

function InsightCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <dt className="text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums text-foreground">
        {value}
      </dd>
    </div>
  );
}

function recipientLabel(recipient: Recipient): string {
  if (recipient.status === "PENDING") return "Waiting";
  if (recipient.status === "SENT") return recipient.delivery ?? "Sent";
  if (recipient.status === "SKIPPED") return "Skipped";

  return "Failed";
}

/** The one date that answers "when does this send, or when did it". */
function whenOf(campaign: Campaign): string {
  const iso = campaign.scheduledAt ?? campaign.startedAt ?? campaign.createdAt;
  const date = new Date(iso);
  const label = campaign.scheduledAt
    ? "Scheduled"
    : campaign.startedAt
      ? "Started"
      : "Created";

  return `${label} ${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} ${date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function clockOf(iso: string | null): string {
  if (!iso) return "—";

  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function slugOf(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "campaign"
  );
}

function readError(caught: unknown): string {
  return caught instanceof ApiError
    ? caught.message
    : "The campaign could not be read.";
}
