"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  Contact,
  GripVertical,
  MessageCircle,
  RotateCcw,
  Send,
  Sparkles,
  UserMinus,
} from "lucide-react";

import {
  DraggableWidgetGrid,
  type WidgetItem,
} from "@/components/ui/draggable-widget-grid";
import {
  previewCategories,
  previewFlow,
  previewKpis,
  previewMode,
  previewSeasonality,
  previewTrend,
} from "@/config/dashboard-preview";
import { useWhatsAppStatus } from "@/hooks/use-whatsapp-status";
import {
  CategoryCard,
  FlowCard,
  KpiTile,
  SeasonalityCard,
  TrendCard,
} from "./charts";
import { ConnectionWidget, SetupWidget } from "./panels";

/**
 * The workspace dashboard: one draggable grid where every card is WhatsApp
 * telemetry. Rearranging is what changes which reading sits where, and the
 * order is remembered per browser.
 *
 * Sizes must tile exactly at four columns — two `lg`, two `tall`, two `wide`
 * and four `sm` fill five rows with no gaps.
 */
const WIDGETS: WidgetItem[] = [
  { id: "delivery-trend", size: "lg", label: "Messages delivered" },
  { id: "setup", size: "lg", label: "Finish setting up" },
  { id: "flow", size: "tall", label: "Inbound vs outbound by hour" },
  { id: "seasonality", size: "tall", label: "Messages by month" },
  { id: "categories", size: "wide", label: "Templates by category" },
  { id: "connection", size: "wide", label: "WhatsApp connection" },
  { id: "contacts", size: "sm", label: "Contacts" },
  { id: "conversations", size: "sm", label: "Open conversations" },
  { id: "delivery-rate", size: "sm", label: "Delivery rate" },
  { id: "opt-outs", size: "sm", label: "Opt-outs" },
];

const STORAGE_KEY = "aotms.dashboard.layout.v1";

export function DashboardBoard() {
  // Remounting the grid is the cleanest reset: it drops the internal order and
  // re-reads storage, which by then is empty.
  const [layoutKey, setLayoutKey] = useState(0);
  // The sample charts are the same either way; only the sentence explaining
  // them changes, and it must not claim there is no number once there is one.
  const connected = useWhatsAppStatus().number !== null;

  const resetLayout = () => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing stored, or storage is unavailable: a remount still resets.
    }
    setLayoutKey((key) => key + 1);
  };

  const renderItem = useCallback((item: WidgetItem) => {
    switch (item.id) {
      case "delivery-trend":
        return <TrendCard {...previewTrend} preview={previewMode} />;
      case "setup":
        return <SetupWidget />;
      case "flow":
        return (
          <FlowCard
            title="Inbound vs outbound"
            total={previewFlow.total}
            note={previewFlow.note}
            inbound={previewFlow.inbound}
            outbound={previewFlow.outbound}
            priorInbound={previewFlow.priorInbound}
            priorOutbound={previewFlow.priorOutbound}
            preview={previewMode}
          />
        );
      case "seasonality":
        return (
          <SeasonalityCard
            title={previewSeasonality.title}
            months={previewSeasonality.months}
            current={previewSeasonality.current}
            previous={previewSeasonality.previous}
            previousLabel={previewSeasonality.previousLabel}
            preview={previewMode}
          />
        );
      case "categories":
        return (
          <CategoryCard
            title={previewCategories.title}
            groups={previewCategories.groups}
            items={previewCategories.items}
            preview={previewMode}
          />
        );
      case "connection":
        return <ConnectionWidget />;
      case "contacts":
        return (
          <KpiTile
            label="Contacts"
            value={previewKpis.contacts.value}
            hint={previewKpis.contacts.hint}
            icon={Contact}
            accent="brand"
            preview={previewMode}
          />
        );
      case "conversations":
        return (
          <KpiTile
            label="Open chats"
            value={previewKpis.conversations.value}
            hint={previewKpis.conversations.hint}
            icon={MessageCircle}
            accent="blue"
            preview={previewMode}
          />
        );
      case "delivery-rate":
        return (
          <KpiTile
            label="Delivery rate"
            value={previewKpis.delivery.value}
            hint={previewKpis.delivery.hint}
            icon={Send}
            accent="lime"
            preview={previewMode}
          />
        );
      case "opt-outs":
        return (
          <KpiTile
            label="Opt-outs"
            value={previewKpis.optouts.value}
            hint={previewKpis.optouts.hint}
            icon={UserMinus}
            accent="muted"
            preview={previewMode}
          />
        );
      default:
        return null;
    }
  }, []);

  return (
    <div className="space-y-4">
      {previewMode ? (
        <div
          role="status"
          className="flex flex-wrap items-start gap-3 rounded-xl border border-brand/25 bg-brand-soft/50 px-4 py-3"
        >
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-brand/12 text-brand">
            <Sparkles className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              Preview data
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {connected ? (
                <>
                  These charts are still a sample of a connected workspace. Your
                  number is connected, so live readings replace the samples as
                  reporting lands.{" "}
                  <Link
                    href="/workspace/whatsapp"
                    className="font-medium text-brand underline-offset-2 hover:underline"
                  >
                    Open the connection
                  </Link>{" "}
                  to see what Meta confirmed.
                </>
              ) : (
                <>
                  This account has no WhatsApp Business number, so the numbers
                  below are a sample of what a connected workspace looks like.{" "}
                  <Link
                    href="/workspace/whatsapp"
                    className="font-medium text-brand underline-offset-2 hover:underline"
                  >
                    Connect a number
                  </Link>{" "}
                  to replace every card with live traffic.
                </>
              )}
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <GripVertical className="size-3.5 shrink-0" aria-hidden="true" />
          Drag any card to rearrange. Hold Alt and use the arrows with a
          keyboard. The layout is saved on this device.
        </p>
        <button
          type="button"
          onClick={resetLayout}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-brand/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Reset layout
        </button>
      </div>

      <DraggableWidgetGrid
        key={layoutKey}
        items={WIDGETS}
        storageKey={STORAGE_KEY}
        renderItem={renderItem}
        cellSize={230}
        maxColumns={4}
        gap={12}
        radius={12}
      />
    </div>
  );
}
