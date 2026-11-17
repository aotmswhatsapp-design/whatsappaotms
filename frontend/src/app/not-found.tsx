import { CtaLink } from "@/components/marketing/cta-link";
import { site } from "@/config/site";

/** Branded 404, reachable from the root layout for any unmatched path. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col justify-center px-4 py-24 sm:px-6">
      <p className="caption-3 text-brand">404</p>
      <h1 className="heading-2 mt-4 max-w-[680px]">This page is not here</h1>
      <p className="title-2 mt-6 max-w-[680px] text-muted-foreground">
        The link may be old, or the page may have moved.
      </p>
      <div className="mt-8 flex flex-col gap-2 sm:flex-row">
        <CtaLink href="/">Back to the home page</CtaLink>
        <CtaLink href={site.links.pricing} variant="outline">
          See the plans
        </CtaLink>
      </div>
    </main>
  );
}
