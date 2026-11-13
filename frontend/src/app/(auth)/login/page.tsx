import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { LoginForm } from "@/components/auth/login-form";
import { site } from "@/config/site";

export const metadata: Metadata = { title: "Log in" };

/**
 * Auth screen on white paper. The marketing navbar is orange, so dropping the
 * shader here makes the sign-in feel like a document rather than a second
 * landing page — the orange survives only in the button, focus rings and links.
 */
export default function LoginPage() {
  return (
    <main className="relative isolate flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-white px-5 py-16">
      {/* Barely-there warmth so the white field has depth instead of reading as
          a blank rectangle. Kept under 6% so it never fights the form. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(60%_100%_at_50%_0%,rgba(234,88,12,0.06),transparent_70%)]"
      />

      <Link
        className="absolute left-4 top-4 z-10 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-secondary hover:text-foreground sm:left-6 sm:top-6"
        href="/"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Back to site
      </Link>

      <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-8">
        {/* Navy lockup on transparent — on white it needs no plate at all. */}
        <Image
          alt={site.logo.alt}
          className="h-8 w-auto"
          height={site.logo.height}
          priority
          src={site.logo.src}
          width={site.logo.width}
        />

        <LoginForm />
      </div>
    </main>
  );
}
