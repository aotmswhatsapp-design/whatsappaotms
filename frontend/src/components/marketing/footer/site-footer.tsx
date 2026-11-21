import Link from "next/link";
import { Plus } from "@phosphor-icons/react/dist/ssr";

import { site } from "@/config/site";
import { cn } from "@/lib/utils";

const brandName = site.name.trim() || "AOTMS";

/**
 * Resolved once when the module loads. `cacheComponents` rejects reading the
 * clock while rendering, and a copyright year is not more precise than the
 * deploy that produced the page.
 */
const COPYRIGHT_YEAR = new Date().getFullYear();

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Features", href: site.links.features },
      { label: "How it works", href: "/how-it-works" },
      { label: "Pricing", href: site.links.pricing },
      { label: "FAQ", href: "/faq" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Contact", href: site.links.contact },
      { label: "Refund policy", href: site.links.refund },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: site.links.privacy },
      { label: "Terms", href: site.links.terms },
    ],
  },
];

const focusRing =
  "focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none";

const footerLink =
  "title-4 text-muted-foreground transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-foreground";

const columnHeading = "caption-3 tracking-wider text-muted-foreground uppercase";

/**
 * Closing screen. The page ends on the brand rather than a strip of small
 * print: the footer is at least one viewport tall, the link columns sit at the
 * top, and the name is set large and fading into the page so scrolling to the
 * bottom always lands on the wordmark.
 *
 * It carries the last black band of the palette. The scope is on the element
 * itself, so the giant wordmark fades from light ink into near black without
 * any of the classes below changing.
 *
 * On phones the columns fold into native `<details>` rows, which need no
 * JavaScript; the plus turns into a cross on the base curve.
 */
export function SiteFooter() {
  return (
    <footer
      data-theme="ink"
      className="relative flex min-h-dvh flex-col overflow-hidden border-t border-border bg-background"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 pt-16 sm:px-6 lg:px-8 lg:pt-24">
        <div className="my-auto grid gap-12 md:grid-cols-12">
          <div className="md:col-span-5">
            <Link
              href="/"
              className={cn(
                "heading-4 inline-flex rounded-md tracking-tight",
                focusRing,
              )}
            >
              {brandName}
            </Link>
            <p className="body-3 mt-4 max-w-xs text-muted-foreground">
              {site.description}
            </p>
            <a
              href={`mailto:${site.email}`}
              className={cn(
                "body-5 mt-6 inline-flex rounded-md text-brand transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-foreground",
                focusRing,
              )}
            >
              {site.email}
            </a>
          </div>

          <nav
            aria-label="Footer"
            className="hidden md:col-span-6 md:col-start-7 md:grid md:grid-cols-2 md:gap-8 lg:grid-cols-3"
          >
            {COLUMNS.map((column) => (
              <div key={column.title}>
                <h2 className={columnHeading}>{column.title}</h2>
                <ul className="mt-4 flex flex-col gap-3">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className={cn(footerLink, "rounded-md py-1", focusRing)}
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <nav aria-label="Footer" className="-mx-4 grid gap-1 md:hidden">
            {COLUMNS.map((column) => (
              <details
                key={column.title}
                className="group rounded-xl open:bg-secondary"
              >
                <summary
                  className={cn(
                    "flex h-14 cursor-pointer list-none items-center justify-between rounded-xl px-4 [&::-webkit-details-marker]:hidden",
                    focusRing,
                  )}
                >
                  <span className={columnHeading}>{column.title}</span>
                  <Plus
                    className="size-4 text-muted-foreground transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-open:rotate-45 motion-reduce:transition-none"
                    weight="bold"
                    aria-hidden="true"
                  />
                </summary>
                <ul className="flex flex-col px-4 pb-4">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className={cn(footerLink, "block rounded-md py-3", focusRing)}
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </nav>
        </div>

        <div className="flex flex-col gap-2 pt-12 pb-6 sm:flex-row sm:items-center sm:gap-6">
          <p className="caption-2 text-muted-foreground">
            © {COPYRIGHT_YEAR} {brandName}
          </p>
          <a
            href={`mailto:${site.email}`}
            className={cn(
              "caption-2 rounded-md text-muted-foreground transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-foreground",
              focusRing,
            )}
          >
            {site.email}
          </a>
        </div>
      </div>

      {/* The name, filling the last screen and dissolving into the page. It is
          decorative: the same words are already a heading and a copyright line. */}
      <p
        aria-hidden="true"
        className="pointer-events-none -mb-[0.18em] w-full bg-linear-to-b from-foreground/30 to-transparent to-72% bg-clip-text text-center text-[clamp(4.5rem,24vw,22rem)] leading-[0.85] font-medium tracking-[-0.04em] text-transparent select-none"
      >
        {brandName}
      </p>
    </footer>
  );
}
