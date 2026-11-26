"use client";

import * as React from "react";
import { Check, LoaderCircle, RotateCcw, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  CONFIGURABLE_ROLES,
  MODULE_HINTS,
  MODULE_LABELS,
  ROLE_SUMMARIES,
  ROLE_TITLES,
  type ConfigurableRole,
  type ModuleKey,
} from "@/config/modules";

import {
  ApiError,
  fetchPermissions,
  savePermissions,
  type PermissionsView,
  type RolePermissions,
} from "../api";

/**
 * What each role may open, as the owner decides it.
 *
 * The matrix is one write: every toggle edits local state and "Save" sends the
 * three lists together, so a role can never be left reading a matrix its
 * neighbours no longer match. The seeded defaults are what the screen shows
 * before the owner changes anything, and "Reset" puts them back without a
 * round trip.
 */
export function PermissionsCard() {
  const toast = useToast();

  const [view, setView] = React.useState<PermissionsView | null>(null);
  const [draft, setDraft] = React.useState<RolePermissions | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let active = true;

    fetchPermissions()
      .then((next) => {
        if (!active) return;
        setView(next);
        setDraft(next.roles);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(
          caught instanceof ApiError
            ? caught.message
            : "The permission matrix could not be read.",
        );
      });

    return () => {
      active = false;
    };
  }, [attempt]);

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <p className="text-sm font-semibold text-foreground">
          The permissions could not be read
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          {error}
        </p>
        <Button
          className="mt-4"
          onClick={() => setAttempt((n) => n + 1)}
          size="sm"
        >
          Try again
        </Button>
      </div>
    );
  }

  if (!view || !draft) {
    return (
      <div
        aria-hidden="true"
        className="h-64 animate-pulse rounded-xl border border-border bg-card"
      />
    );
  }

  const dirty = CONFIGURABLE_ROLES.some(
    (role) => !sameSet(draft[role], view.roles[role]),
  );

  function toggle(role: ConfigurableRole, module: ModuleKey) {
    setDraft((current) => {
      if (!current) return current;
      const has = current[role].includes(module);
      return {
        ...current,
        [role]: has
          ? current[role].filter((key) => key !== module)
          : [...current[role], module],
      };
    });
  }

  async function save() {
    if (!draft || saving) return;

    setSaving(true);

    try {
      const next = await savePermissions(draft);
      setView(next);
      setDraft(next.roles);
      toast.push({
        tone: "success",
        title: "Permissions saved",
        description:
          "Each role now sees exactly the modules you left switched on.",
      });
    } catch (caught) {
      toast.push({
        tone: "error",
        title: "Could not save the permissions",
        description:
          caught instanceof ApiError ? caught.message : "The request failed.",
        duration: 0,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
          <ShieldCheck className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">
            Module access per role
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            A module that is off disappears from that role&apos;s sidebar and
            its endpoints answer 403. Everyone shares the same contacts,
            conversations and training material — what changes is which screens
            they can reach. You always see everything.
          </p>
        </div>
      </div>

      {!view.stored ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px] leading-relaxed text-foreground">
          The toggles table is not installed on this database yet, so these are
          the seeded defaults and changes cannot be saved. Run{" "}
          <code className="font-mono">npx prisma migrate deploy</code> from{" "}
          <code className="font-mono">Backend/</code> to enable the switches.
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[42rem] border-separate border-spacing-0 text-left">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-card pb-2 pr-3 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
                Module
              </th>
              {CONFIGURABLE_ROLES.map((role) => (
                <th
                  key={role}
                  className="w-28 pb-2 px-2 text-center text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase"
                >
                  {ROLE_TITLES[role]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.modules.map((module) => (
              <tr key={module.key} className="align-top">
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-t border-border bg-card py-2.5 pr-3 font-normal"
                >
                  <span className="block text-[13px] font-medium text-foreground">
                    {module.label || MODULE_LABELS[module.key]}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">
                    {MODULE_HINTS[module.key]}
                  </span>
                </th>
                {CONFIGURABLE_ROLES.map((role) => (
                  <td
                    key={role}
                    className="border-t border-border px-2 py-2.5 text-center"
                  >
                    <label className="inline-flex cursor-pointer items-center justify-center">
                      <input
                        type="checkbox"
                        checked={draft[role].includes(module.key)}
                        disabled={!view.stored || saving}
                        onChange={() => toggle(role, module.key)}
                        className="size-4 cursor-pointer accent-brand disabled:cursor-not-allowed"
                        aria-label={`${MODULE_LABELS[module.key]} for ${ROLE_TITLES[role]}`}
                      />
                    </label>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="space-y-1.5 border-t border-border pt-4 text-[12.5px] leading-relaxed text-muted-foreground">
        {CONFIGURABLE_ROLES.map((role) => (
          <div key={role} className="flex gap-1.5">
            <dt className="shrink-0 font-medium text-foreground">
              {ROLE_TITLES[role]}
            </dt>
            <dd className="min-w-0">{ROLE_SUMMARIES[role]}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        <Button
          disabled={!dirty || saving}
          onClick={() => {
            setDraft(view.roles);
          }}
          size="sm"
          variant="ghost"
        >
          <RotateCcw aria-hidden="true" />
          Reset
        </Button>
        <Button
          disabled={!dirty || saving || !view.stored}
          onClick={save}
          size="sm"
        >
          {saving ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <Check aria-hidden="true" />
          )}
          Save permissions
        </Button>
      </div>
    </section>
  );
}

/** Set equality: order never matters in a list of enabled modules. */
function sameSet(a: readonly ModuleKey[], b: readonly ModuleKey[]): boolean {
  if (a.length !== b.length) return false;
  const left = new Set(a);
  return b.every((key) => left.has(key));
}
