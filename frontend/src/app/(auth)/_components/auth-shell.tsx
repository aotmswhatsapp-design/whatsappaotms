import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { site } from "@/config/site";

/**
 * Frame shared by every auth screen: a white sheet, a faint warm wash at the top
 * that pulls the eye down to the card, the wordmark, and one card. The
 * marketing navbar is dropped deliberately — sign-in should read as a document,
 * not a second landing page.
 *
 * `data-theme="sheet"` is what makes the screen pure white: the app palette
 * is a warm pearl sheet, and a sign-in page reads better as plain paper. Every
 * surface inside — card, border, field fill, muted ink — follows from that
 * block.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main
      className="relative isolate flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-5 py-16"
      data-theme="sheet"
    >
      {/* A wash of the brand orange rather than grey: on white a neutral scrim
          reads as dirt. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(60%_100%_at_50%_0%,rgba(213,54,12,0.06),transparent_70%)]"
      />

      <Link
        className="absolute left-4 top-4 z-10 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-secondary hover:text-foreground sm:left-6 sm:top-6"
        href="/"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Back to site
      </Link>

      <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-8">
        {/* No plate behind the mark any more: the ivory one existed because the
            wordmark's orange vanished on the old burnt field, and on white it
            would only be a rectangle around a white box. */}
        <Image
          alt={site.logo.alt}
          className="h-8 w-auto"
          height={site.logo.height}
          priority
          src={site.logo.src}
          width={site.logo.width}
        />

        {children}
      </div>
    </main>
  );
}
