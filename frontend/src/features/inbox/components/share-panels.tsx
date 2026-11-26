"use client";

import * as React from "react";
import {
  Crosshair,
  Loader2,
  MapPin,
  SendHorizontal,
  UserRound,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";

import {
  ApiError,
  sendContact,
  sendLocation,
  type InboxMessage,
} from "../api";

/**
 * Sharing a location or a contact card.
 *
 * Both are ordinary service messages, so both obey the 24-hour window and both
 * are sent from the settled thread rather than from the typing bar. The forms
 * stay small on purpose: Meta takes two numbers and two optional labels for a
 * pin, four fields for a card, and anything more would be a form pretending to
 * be a chat.
 */

const FIELD =
  "h-8 w-full min-w-0 rounded-lg border border-border bg-card px-2 text-[11.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-brand/40 focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:opacity-50";

const LABEL = "block text-[10px] font-medium text-muted-foreground";

const SEND =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-brand px-3 text-[11.5px] font-semibold text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-40";

const ICON_BUTTON =
  "grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40";

/** The panel's own heading, so both forms open the same way. */
function PanelHeader({
  icon,
  title,
  onClose,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="sticky top-0 z-10 flex min-w-0 items-center gap-1.5 bg-card">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-foreground">
        {title}
      </span>
      {children}
      <button
        type="button"
        aria-label="Close this panel"
        className={ICON_BUTTON}
        onClick={onClose}
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}

/** A failure line, drawn the same way the composer draws its own. */
function PanelError({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <p className="mt-2 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-destructive">
      {message}
    </p>
  );
}

export function LocationPanel({
  conversationId,
  locked,
  onSent,
  onClose,
}: {
  conversationId: string;
  locked: boolean;
  onSent: (message: InboxMessage) => void;
  onClose: () => void;
}) {
  const [latitude, setLatitude] = React.useState("");
  const [longitude, setLongitude] = React.useState("");
  const [name, setName] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [locating, setLocating] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const lat = Number(latitude);
  const lng = Number(longitude);
  const ready =
    !locked &&
    !busy &&
    latitude.trim().length > 0 &&
    longitude.trim().length > 0 &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180;

  /**
   * The browser's own position, so an agent standing at the shop does not have
   * to look a pair of numbers up. Refusal is expected — it is a permission
   * prompt — so it explains the alternative instead of sounding like a failure.
   */
  function locate(): void {
    if (!navigator.geolocation) {
      setError("This browser cannot read your location. Type the coordinates instead.");
      return;
    }

    setLocating(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude.toFixed(6));
        setLongitude(position.coords.longitude.toFixed(6));
        setLocating(false);
      },
      () => {
        setLocating(false);
        setError(
          "Location was refused. Type the coordinates instead, or allow it in the browser.",
        );
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function submit(): Promise<void> {
    if (!ready) return;

    setBusy(true);
    setError(null);

    try {
      const { message } = await sendLocation(conversationId, {
        latitude: lat,
        longitude: lng,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(address.trim() ? { address: address.trim() } : {}),
      });

      onSent(message);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not send that location. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Share a location"
      className="rounded-xl border border-border bg-card p-2"
    >
      <PanelHeader
        icon={<MapPin aria-hidden="true" className="size-3.5" />}
        title="Share a location"
        onClose={onClose}
      />

      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        <label className="min-w-0">
          <span className={LABEL}>Latitude</span>
          <input
            className={cn(FIELD, "mt-0.5")}
            disabled={busy}
            inputMode="decimal"
            name="latitude"
            placeholder="19.076090"
            value={latitude}
            onChange={(event) => setLatitude(event.target.value)}
          />
        </label>

        <label className="min-w-0">
          <span className={LABEL}>Longitude</span>
          <input
            className={cn(FIELD, "mt-0.5")}
            disabled={busy}
            inputMode="decimal"
            name="longitude"
            placeholder="72.877426"
            value={longitude}
            onChange={(event) => setLongitude(event.target.value)}
          />
        </label>

        <label className="min-w-0">
          <span className={LABEL}>Name (optional)</span>
          <input
            className={cn(FIELD, "mt-0.5")}
            disabled={busy}
            name="location-name"
            placeholder="Our shop"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label className="min-w-0">
          <span className={LABEL}>Address (optional)</span>
          <input
            className={cn(FIELD, "mt-0.5")}
            disabled={busy}
            name="location-address"
            placeholder="Street, area, city"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
        </label>
      </div>

      <PanelError message={error} />

      {/* Pinned while the panel scrolls inside the composer, so Send never
          slides out of the card. */}
      <div className="sticky bottom-0 z-10 mt-2 flex items-center justify-between gap-2 bg-card pt-1">
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-40"
          disabled={busy || locating}
          onClick={locate}
        >
          {locating ? (
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          ) : (
            <Crosshair aria-hidden="true" className="size-3.5" />
          )}
          Use my location
        </button>

        <button
          type="button"
          className={SEND}
          disabled={!ready}
          onClick={() => void submit()}
        >
          {busy ? (
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          ) : (
            <SendHorizontal aria-hidden="true" className="size-3.5" />
          )}
          Send location
        </button>
      </div>

      {locked ? (
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          The 24-hour window has closed, so this cannot be sent until the
          customer writes again.
        </p>
      ) : null}
    </section>
  );
}

export function ContactPanel({
  conversationId,
  locked,
  onSent,
  onClose,
}: {
  conversationId: string;
  locked: boolean;
  onSent: (message: InboxMessage) => void;
  onClose: () => void;
}) {
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [organization, setOrganization] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // A name is the only thing Meta insists on; a phone is what makes the card
  // worth sending, so the form asks for both without requiring the second.
  const ready = !locked && !busy && name.trim().length > 0;

  async function submit(): Promise<void> {
    if (!ready) return;

    setBusy(true);
    setError(null);

    try {
      const { message } = await sendContact(conversationId, {
        name: name.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(organization.trim() ? { organization: organization.trim() } : {}),
      });

      onSent(message);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not send that contact card. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Share a contact card"
      className="rounded-xl border border-border bg-card p-2"
    >
      <PanelHeader
        icon={<UserRound aria-hidden="true" className="size-3.5" />}
        title="Share a contact"
        onClose={onClose}
      />

      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        <label className="min-w-0">
          <span className={LABEL}>Name</span>
          <input
            className={cn(FIELD, "mt-0.5")}
            disabled={busy}
            name="contact-name"
            placeholder="Full name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label className="min-w-0">
          <span className={LABEL}>Phone (optional)</span>
          <input
            className={cn(FIELD, "mt-0.5")}
            disabled={busy}
            inputMode="tel"
            name="contact-phone"
            placeholder="+91 98765 43210"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </label>

        <label className="min-w-0">
          <span className={LABEL}>Email (optional)</span>
          <input
            className={cn(FIELD, "mt-0.5")}
            disabled={busy}
            inputMode="email"
            name="contact-email"
            placeholder="name@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label className="min-w-0">
          <span className={LABEL}>Organization (optional)</span>
          <input
            className={cn(FIELD, "mt-0.5")}
            disabled={busy}
            name="contact-organization"
            placeholder="Company"
            value={organization}
            onChange={(event) => setOrganization(event.target.value)}
          />
        </label>
      </div>

      <PanelError message={error} />

      {/* Pinned while the panel scrolls inside the composer, so Send never
          slides out of the card. */}
      <div className="sticky bottom-0 z-10 mt-2 flex items-center justify-between gap-2 bg-card pt-1">
        <p className="min-w-0 text-[10px] leading-relaxed text-muted-foreground">
          The customer can save it straight into their address book.
        </p>

        <button
          type="button"
          className={SEND}
          disabled={!ready}
          onClick={() => void submit()}
        >
          {busy ? (
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          ) : (
            <SendHorizontal aria-hidden="true" className="size-3.5" />
          )}
          Send contact
        </button>
      </div>

      {locked ? (
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          The 24-hour window has closed, so this cannot be sent until the
          customer writes again.
        </p>
      ) : null}
    </section>
  );
}
