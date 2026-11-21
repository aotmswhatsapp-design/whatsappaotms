import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/workspace/page-header";
import { PlannedCapabilities } from "@/components/workspace/planned-capabilities";
import { BusinessProfileForm } from "@/features/business/components/business-profile-form";
import { BusinessProfileCard } from "@/features/whatsapp/components/business-profile-card";
import { getNavItem } from "@/config/workspace-nav";
import { getSessionUser } from "@/lib/auth/session";

const nav = getNavItem("/workspace/profile");

export const metadata: Metadata = { title: nav.title };

/**
 * The only value we already know server-side is the signed-in address; every
 * stored field is read by the form itself, because the request needs the
 * browser's session token.
 */
async function ProfileForm() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return <BusinessProfileForm accountEmail={user.email} />;
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
        description="Two different profiles. The WhatsApp card is what customers see in the chat and is owned by Meta; the fields below are your own workspace details."
        eyebrow={nav.group}
        title={nav.title}
      />

      <BusinessProfileCard />

      <Suspense fallback={<ProfileSkeleton />}>
        <ProfileForm />
      </Suspense>

      <PlannedCapabilities
        items={[
          "Company logo",
          "Business hours for automation",
          "Default language for replies",
          "Per-agent signatures",
        ]}
      />
    </div>
  );
}
