import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/workspace/page-header";
import { PlannedCapabilities } from "@/components/workspace/planned-capabilities";
import { getNavItem } from "@/config/workspace-nav";
import { getSessionUser } from "@/lib/auth/session";

const nav = getNavItem("/workspace/profile");

export const metadata: Metadata = { title: nav.title };

const FIELDS = [
  { label: "Company name", name: "companyName", placeholder: "Your company" },
  { label: "Website", name: "website", placeholder: "https://example.com" },
  { label: "Timezone", name: "timezone", placeholder: "Asia/Kolkata" },
  { label: "Support number", name: "supportNumber", placeholder: "+91 " },
];

/**
 * Read-only until the business-profile endpoint exists: the only value we
 * actually know is the signed-in account address.
 */
async function ProfileForm() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <form className="rounded-xl border border-border bg-card p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">
            Account email
          </span>
          <input
            readOnly
            className="mt-1.5 h-9 w-full rounded-lg border border-border bg-secondary/60 px-3 text-sm text-foreground outline-none"
            name="accountEmail"
            type="email"
            value={user.email}
          />
        </label>

        {FIELDS.map((field) => (
          <label key={field.name} className="block">
            <span className="text-xs font-medium text-muted-foreground">
              {field.label}
            </span>
            <input
              readOnly
              className="mt-1.5 h-9 w-full rounded-lg border border-border bg-secondary/60 px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
              name={field.name}
              placeholder={field.placeholder}
              type="text"
            />
          </label>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button disabled variant="brand">
          Save changes
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Editing unlocks with the business-profile endpoint.
        </p>
      </div>
    </form>
  );
}

function ProfileSkeleton() {
  return (
    <div
      className="h-72 animate-pulse rounded-xl border border-border bg-card"
      aria-hidden="true"
    />
  );
}

export default function BusinessProfilePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        description="These details are what customers see when your chatbot introduces the business. They stay inside your own database."
        eyebrow={nav.group}
        title={nav.title}
      />

      <Suspense fallback={<ProfileSkeleton />}>
        <ProfileForm />
      </Suspense>

      <PlannedCapabilities
        items={[
          "Company name, logo and description",
          "Support number and contact email",
          "Timezone used for scheduled sends",
          "Business hours for automation",
          "Default language for replies",
          "PATCH /api/business/profile with validation",
        ]}
      />
    </div>
  );
}
