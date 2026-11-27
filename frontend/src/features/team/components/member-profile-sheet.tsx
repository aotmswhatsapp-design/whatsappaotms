"use client";

import * as React from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { ApiError, updateMemberProfile, type Member } from "../api";

const FIELD =
  "mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-3 text-[13.5px] text-foreground shadow-xs outline-none transition-shadow placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px]";

/**
 * The three things an owner sets about a person that are not their role: the
 * name colleagues see, the designation lead rotation sorts by, and the number
 * the "Send from my WhatsApp" link opens.
 *
 * Email is deliberately absent — it is the Supabase identity, and changing it
 * is a verified flow of its own, not a field on this form.
 */
export function MemberProfileSheet({
  member,
  designations,
  onClose,
  onSaved,
}: {
  member: Member;
  designations: string[];
  onClose: () => void;
  onSaved: (member: Member) => void;
}) {
  const toast = useToast();
  const [name, setName] = React.useState(member.name ?? "");
  const [designation, setDesignation] = React.useState(member.designation ?? "");
  const [personal, setPersonal] = React.useState(member.personalWhatsApp ?? "");
  const [busy, setBusy] = React.useState(false);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    // The field accepts spaces and dashes a person types out of habit; the
    // number that leaves is digits only, because that is what `wa.me` takes.
    const digits = personal.replace(/\D+/g, "");

    if (digits && (digits.length < 8 || digits.length > 15)) {
      toast.push({
        tone: "error",
        title: "The number needs 8 to 15 digits, country code first",
        duration: 0,
      });
      return;
    }

    setBusy(true);

    try {
      const { member: next } = await updateMemberProfile(member.userId, {
        // Omitted rather than sent empty: an empty name would clear the one
        // the person signed up with.
        fullName: name.trim() || undefined,
        designation: designation.trim() || null,
        personalWhatsApp: digits || null,
      });

      onSaved(next);
      toast.push({
        tone: "success",
        title: "Profile saved",
        description: next.name ?? next.email,
      });
    } catch (caught) {
      toast.push({
        tone: "error",
        title: "Could not save the profile",
        description:
          caught instanceof ApiError ? caught.message : "The request failed.",
        duration: 0,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        // The sheet has no open state of its own: the row holding it decides,
        // so every close path (Escape, overlay, the X) lands in one place.
        if (!open && !busy) onClose();
      }}
    >
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{member.name ?? member.email}</SheetTitle>
          <SheetDescription>
            These details stay inside the workspace. The number is only ever
            used to open a chat in that member&apos;s own WhatsApp.
          </SheetDescription>
        </SheetHeader>

        <form
          className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4"
          onSubmit={(event) => void save(event)}
        >
          <div>
            <Label htmlFor="profile-name">Name</Label>
            <input
              className={FIELD}
              id="profile-name"
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              placeholder="The name colleagues see"
              type="text"
              value={name}
            />
          </div>

          <div>
            <Label htmlFor="profile-designation">Designation</Label>
            <input
              className={FIELD}
              id="profile-designation"
              list="profile-designations"
              maxLength={40}
              onChange={(event) => setDesignation(event.target.value)}
              placeholder="Sales, Support, Dispatch"
              type="text"
              value={designation}
            />
            <datalist id="profile-designations">
              {designations.map((row) => (
                <option key={row} value={row} />
              ))}
            </datalist>
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
              Lead rotation sorts by this exact label, so reuse one that already
              exists. Two spellings are two pools that never merge.
            </p>
          </div>

          <div>
            <Label htmlFor="profile-whatsapp">Personal WhatsApp</Label>
            <input
              className={cn(FIELD, "font-mono")}
              id="profile-whatsapp"
              inputMode="numeric"
              maxLength={15}
              onChange={(event) => setPersonal(event.target.value)}
              placeholder="919876543210"
              type="text"
              value={personal}
            />
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
              Digits only, with the country code. Nothing is sent from here by
              itself — the follow-up link opens the chat and the member sends.
            </p>
          </div>

          {/* Read-only, with the reason stated: the address is the Supabase
              identity, and editing it from here would lock the person out
              until they verified the new one. */}
          <div>
            <Label htmlFor="profile-email">Email</Label>
            <input
              className={cn(FIELD, "bg-secondary/60 text-muted-foreground")}
              id="profile-email"
              readOnly
              type="email"
              value={member.email}
            />
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
              The address they sign in with. Changing it needs a verified
              flow of its own, so it is not editable here.
            </p>
          </div>

          <div className="mt-auto flex gap-2 pt-2">
            <Button disabled={busy} size="sm" type="submit">
              {busy ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : null}
              Save profile
            </Button>
            <Button
              disabled={busy}
              onClick={onClose}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
