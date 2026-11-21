import Link from "next/link";

import { site } from "@/config/site";

/**
 * The mint strip between the black utility bar and the navigation.
 *
 * It states what the workspace holds and sends the reader to the section that
 * shows it. The sentence is cut at `sm`: below that the strip would take three
 * lines above the fold, and the first clause already names the product.
 *
 * Mint carries it because it is the first green on the page and the hero below
 * is white; the pill is the palette's emerald, so the strip contains both
 * weights of one colour and nothing else.
 */
export function AnnouncementBar() {
  return (
    <div className="bg-mint">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-center sm:px-6">
        <p className="body-6 text-foreground">
          <span aria-hidden="true">🚀 </span>
          Campaigns, a shared inbox and chatbots in one workspace
          <span className="hidden sm:inline">
            {" "}
            — every conversation gets an answer
          </span>
          .
        </p>
        <Link
          href={site.links.features}
          className="button-sm rounded-full bg-brand px-3 py-1 text-brand-foreground transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-brand/90 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          See the features
        </Link>
      </div>
    </div>
  );
}
