import { Suspense, type ReactNode } from "react";

import { SiteFooter } from "@/components/marketing/footer/site-footer";
import { Navbar } from "@/components/marketing/navbar";
import { SessionNavbar } from "@/features/auth/components/session-navbar";

export default function MarketingLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {/* Falls back to the signed-out navbar so the shell prerenders statically
          and only the avatar arrives with the session. */}
      <Suspense fallback={<Navbar />}>
        <SessionNavbar />
      </Suspense>
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
