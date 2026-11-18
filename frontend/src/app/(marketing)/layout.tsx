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
    /* The landing page carries its own palette. `data-theme` redefines the role
       tokens for this subtree only, so the workspace and auth screens keep the
       app theme in `:root`. `text-foreground` has to be declared here as well
       as on `<body>`: colour is inherited as a computed value, so a heading with
       no colour class would otherwise keep the body's ink on the field. */
    <div
      data-theme="deep"
      className="flex min-h-dvh flex-col bg-background text-foreground"
    >
      {/* Keyboard users land here first; it is off screen until focused. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
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
