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
      {/* Keyboard users land here first; it is off screen until focused. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-foreground focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>
      {/* Falls back to the signed-out navbar so the shell prerenders statically
          and only the avatar arrives with the session. */}
      <Suspense fallback={<Navbar />}>
        <SessionNavbar />
      </Suspense>
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
