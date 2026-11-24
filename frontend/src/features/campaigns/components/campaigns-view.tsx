"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, Megaphone, Plus, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { DataTable } from "@/components/workspace/data-table";
import { EmptyState } from "@/components/workspace/empty-state";
import { PageHeader } from "@/components/workspace/page-header";
import { getNavItem } from "@/config/workspace-nav";
import { cn } from "@/lib/utils";

import {
  ApiError,
  fetchCampaignOptions,
  fetchCampaigns,
  type Campaign,
  type CampaignOptions,
  type CampaignStatus,
  type RecipientImportReport,
} from "../api";
import { CampaignForm } from "./campaign-form";
import { STATUS_LABEL, StatusPill } from "./status-pill";

const nav = getNavItem("/workspace/campaigns");

type Filter = "ALL" | CampaignStatus;

/** Every status the server can hold, including the one the engine sets. */
const FILTERS: { value: Filter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "RUNNING", label: "Running" },
  { value: "PAUSED", label: "Paused" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "FAILED", label: "Failed" },
];

const COLUMNS = [
  { key: "name", label: "Campaign" },
  { key: "template", label: "Template" },
  { key: "audience", label: "Audience" },
  { key: "status", label: "Status" },
  { key: "sent", label: "Sent", className: "text-right" },
  { key: "delivered", label: "Delivered", className: "text-right" },
  { key: "read", label: "Read", className: "text-right" },
  { key: "schedule", label: "Schedule" },
];

/**
 * The campaign list.
 *
 * Every campaign here is an AOTMS send through the WhatsApp Cloud API. Meta's
 * Business Suite campaigns are a separate tool with no API, so they are not
 * read, mirrored or implied — the line under the header says so once, where a
 * reader expecting a mirror will look.
 */
export function CampaignsView() {
  const toast = useToast();
  const [campaigns, setCampaigns] = React.useState<Campaign[] | null>(null);
  const [options, setOptions] = React.useState<CampaignOptions | null>(null);
  const [optionsFailed, setOptionsFailed] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<Filter>("ALL");
  const [creating, setCreating] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let active = true;

    fetchCampaignOptions()
      .then((next) => {
        if (!active) return;
        setOptions(next);
        setOptionsFailed(false);
      })
      .catch(() => {
        if (!active) return;
        setOptions(null);
        setOptionsFailed(true);
      });

    return () => {
      active = false;
    };
  }, [attempt]);

  React.useEffect(() => {
    let active = true;

    fetchCampaigns(filter === "ALL" ? undefined : filter)
      .then((next) => {
        if (!active) return;
        setCampaigns(next.campaigns);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(readError(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [filter, attempt]);

  function reload() {
    setLoading(true);
    setError(null);
    setAttempt((count) => count + 1);
  }

  const canCreate =
    options !== null &&
    options.channel.connected &&
    options.templates.length > 0;

  const blocker = options
    ? !options.channel.connected
      ? "Connect a WhatsApp number before a campaign can send."
      : options.templates.length === 0
        ? "No approved template yet — submit one and wait for Meta's review."
        : null
    : optionsFailed
      ? "The templates and contacts could not be read, so New campaign stays closed until a retry succeeds."
      : "Reading the templates and contacts this can send to…";

  return (
    <div className="space-y-5">
      <PageHeader
        actions={
          <Button
            disabled={!canCreate}
            onClick={() => setCreating(true)}
            type="button"
            variant="brand"
          >
            <Plus />
            New campaign
          </Button>
        }
        description="A campaign is an approved template sent to the numbers you add, or to the contacts carrying the tags you choose. Sending needs a connected number and at least one approved template."
        eyebrow={nav.group}
        title={nav.title}
      />

      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        AOTMS campaigns are sent through the WhatsApp Cloud API. Meta&apos;s
        Business Suite campaigns are a separate tool with no API, so they never
        appear here.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          aria-label="Filter by campaign status"
          className="flex flex-wrap gap-1"
          role="group"
        >
          {FILTERS.map((entry) => (
            <button
              aria-pressed={filter === entry.value}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none",
                filter === entry.value
                  ? "bg-secondary text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
              key={entry.value}
              onClick={() => setFilter(entry.value)}
              type="button"
            >
              {entry.label}
            </button>
          ))}
        </div>

        <Button
          disabled={loading && campaigns !== null}
          onClick={reload}
          size="sm"
          type="button"
          variant="outline"
        >
          <RefreshCw className={cn(loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {blocker ? (
        <p className="rounded-lg border border-warning/45 bg-warning/10 px-3 py-2 text-[12.5px] leading-relaxed text-foreground">
          {blocker}{" "}
          {options && !options.channel.connected ? (
            <Link className="font-medium underline underline-offset-4" href="/workspace/whatsapp">
              Connect WhatsApp
            </Link>
          ) : null}
        </p>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2.5">
          <p className="text-[12.5px] leading-relaxed text-foreground" role="alert">
            {error}
          </p>
          <Button
            className="mt-2"
            onClick={reload}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCw />
            Try again
          </Button>
        </div>
      ) : null}

      {loading && campaigns === null ? (
        <div className="grid h-56 place-items-center rounded-xl border border-border bg-card">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <DataTable
          columns={COLUMNS}
          empty={
            <EmptyState
              action={
                <Button
                  disabled={!canCreate}
                  onClick={() => setCreating(true)}
                  type="button"
                  variant="brand"
                >
                  <Plus />
                  New campaign
                </Button>
              }
              className="border-0 bg-transparent py-8"
              description="Choose an approved template, add your numbers or pick tags, and when to send. Delivery and read counts arrive as Meta confirms them."
              icon={Megaphone}
              title={
                filter === "ALL"
                  ? "No campaigns yet"
                  : `No ${STATUS_LABEL[filter].toLowerCase()} campaign`
              }
            />
          }
          rows={(campaigns ?? []).map((campaign) => [
            <Link
              className="text-[13.5px] font-medium text-foreground hover:text-brand"
              href={`/workspace/campaigns/${campaign.id}`}
              key="name"
            >
              {campaign.name}
            </Link>,
            <div className="min-w-0" key="template">
              <p className="truncate text-[13px] text-foreground">
                {campaign.template.name}
              </p>
              <p className="text-[11.5px] text-muted-foreground">
                {campaign.template.category.toLowerCase()}
              </p>
            </div>,
            <span
              className="block max-w-40 truncate text-[12.5px] text-muted-foreground"
              key="audience"
              title={
                campaign.audienceSource === "LIST"
                  ? "A list of numbers added to this campaign"
                  : campaign.audienceTags.length > 0
                    ? campaign.audienceTags.join(", ")
                    : "Everyone"
              }
            >
              {campaign.audienceSource === "LIST"
                ? `${campaign.counts.total} number${campaign.counts.total === 1 ? "" : "s"}`
                : campaign.audienceTags.length > 0
                  ? campaign.audienceTags.join(", ")
                  : "Everyone"}
            </span>,
            <StatusPill key="status" status={campaign.status} />,
            <span className="block text-right text-[13px] tabular-nums" key="sent">
              {campaign.insights.SENT}
            </span>,
            <span
              className="block text-right text-[13px] tabular-nums"
              key="delivered"
            >
              {campaign.insights.DELIVERED}
            </span>,
            <span className="block text-right text-[13px] tabular-nums" key="read">
              {campaign.insights.READ}
            </span>,
            <span
              className="block text-[12px] whitespace-nowrap text-muted-foreground"
              key="schedule"
            >
              {whenOf(campaign)}
            </span>,
          ])}
        />
      )}

      {creating && options ? (
        <CampaignForm
          onClose={() => setCreating(false)}
          onSaved={(campaign, imported) => {
            setCreating(false);
            toast.push({
              title:
                campaign.status === "SCHEDULED"
                  ? `“${campaign.name}” is scheduled.`
                  : `“${campaign.name}” is saved as a draft.`,
              description: imported ? importSummary(imported) : undefined,
              tone: "success",
            });
            reload();
          }}
          options={options}
        />
      ) : null}
    </div>
  );
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

function readError(caught: unknown): string {
  return caught instanceof ApiError
    ? caught.message
    : "The campaigns could not be read.";
}

/** What the import did, in the one line a toast can hold. */
function importSummary(report: RecipientImportReport): string {
  const parts = [
    `${report.added} number${report.added === 1 ? "" : "s"} added`,
  ];

  if (report.duplicates.count > 0) {
    parts.push(
      `${report.duplicates.count} duplicate${report.duplicates.count === 1 ? "" : "s"} removed`,
    );
  }

  if (report.invalid.count > 0) {
    parts.push(
      `${report.invalid.count} row${report.invalid.count === 1 ? "" : "s"} skipped`,
    );
  }

  return `${parts.join(" · ")}.`;
}
