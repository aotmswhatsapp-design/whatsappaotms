"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";

import { UserMenu } from "@/components/account/user-menu";
import { CtaLink } from "@/components/marketing/cta-link";
import { site } from "@/config/site";
import type { SessionUser } from "@/lib/auth/types";
import { cn } from "@/lib/utils";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

interface MenuItem {
  title: string;
  url: string;
}

interface NavbarProps {
  logo?: {
    url: string;
    src: string;
    alt: string;
    title?: string;
  };
  menu?: MenuItem[];
  auth?: {
    login: { text: string; url: string };
    signup: { text: string; url: string };
  };
  /**
   * Signed-in user, resolved by the layout inside a Suspense boundary. `null`
   * or omitted renders the Log in / Start a plan pair instead.
   */
  user?: SessionUser | null;
}

const itemBase =
  "title-4 rounded-lg px-3 py-2 transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none";

/**
 * Full width navigation that sits flush against the top edge on a plain
 * surface, separated from the page by a single hairline. The bar is the page
 * grid, not a floating object, so it lines up with every section below it.
 * Below the large breakpoint it collapses into a full height panel whose links
 * arrive one after another.
 */
const Navbar = ({
  logo = {
    url: "/",
    src: site.logo.src,
    alt: site.logo.alt,
    title: site.name,
  },
  menu = [
    { title: "Features", url: site.links.features },
    { title: "How it works", url: "/how-it-works" },
    { title: "Pricing", url: site.links.pricing },
    { title: "FAQ", url: "/faq" },
  ],
  auth = {
    login: { text: "Log in", url: site.links.login },
    signup: { text: "Start a plan", url: site.links.pricing },
  },
  user = null,
}: NavbarProps) => {
  const [open, setOpen] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);
  const pathname = usePathname();

  // Transparent over the top of the page, then a solid bar once the reader
  // moves. The first read runs in a frame callback so the effect never sets
  // state synchronously.
  React.useEffect(() => {
    const sync = () => setScrolled(window.scrollY > 8);
    const frame = requestAnimationFrame(sync);
    window.addEventListener("scroll", sync, { passive: true });

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", sync);
    };
  }, []);

  React.useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // No backdrop-filter on the wrapper: it would become the containing block
  // for the fixed mobile panel below and trap it inside the bar.
  return (
    <div
      className={cn(
        "sticky top-0 z-50 border-b transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
        scrolled
          ? "border-border bg-background"
          : "border-transparent bg-transparent",
      )}
    >
      <header className="mx-auto flex h-18 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href={logo.url}
          className="rounded-md focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <Image
            src={logo.src}
            alt={logo.alt}
            width={site.logo.width}
            height={site.logo.height}
            sizes="142px"
            priority
            className="h-9 w-auto"
          />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {menu.map((item) => {
            const current = pathname === item.url;
            return (
              <Link
                key={item.url}
                href={item.url}
                aria-current={current ? "page" : undefined}
                className={cn(
                  itemBase,
                  current
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                {item.title}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          {user ? (
            <UserMenu user={user} tone="plain" />
          ) : (
            <>
              <Link
                href={auth.login.url}
                className={cn(
                  itemBase,
                  "text-muted-foreground hover:text-foreground",
                )}
              >
                {auth.login.text}
              </Link>
              <CtaLink href={auth.signup.url} size="sm">
                {auth.signup.text}
              </CtaLink>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className="-mr-2 inline-flex size-11 items-center justify-center rounded-lg text-foreground transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-secondary focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none lg:hidden"
        >
          <ToggleGlyph open={false} />
        </button>
      </header>

      <AnimatePresence>
        {open ? (
          <motion.div
            key="mobile-panel"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="fixed inset-0 z-50 flex flex-col bg-background lg:hidden"
          >
            <div className="flex h-18 items-center justify-between border-b border-border px-4 sm:px-6">
              <Link
                href={logo.url}
                onClick={() => setOpen(false)}
                className="rounded-md focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <Image
                  src={logo.src}
                  alt={logo.alt}
                  width={site.logo.width}
                  height={site.logo.height}
                  sizes="142px"
                  loading="eager"
                  className="h-9 w-auto"
                />
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="inline-flex size-11 items-center justify-center rounded-lg text-foreground transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-secondary focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <ToggleGlyph open />
              </button>
            </div>

            <motion.nav
              aria-label="Main"
              initial="closed"
              animate="open"
              variants={{ closed: {}, open: {} }}
              className="flex flex-col gap-2 px-4 pt-8 sm:px-6"
            >
              {menu.map((item, index) => (
                <motion.div
                  key={item.url}
                  variants={{
                    closed: { opacity: 0, y: 24 },
                    open: {
                      opacity: 1,
                      y: 0,
                      // 60ms per link keeps the whole sequence under 400ms.
                      transition: { duration: 0.5, delay: index * 0.06, ease: EASE },
                    },
                  }}
                >
                  <Link
                    href={item.url}
                    onClick={() => setOpen(false)}
                    aria-current={pathname === item.url ? "page" : undefined}
                    className={cn(
                      "heading-4 block rounded-lg px-2 py-3 transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                      pathname === item.url
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {item.title}
                  </Link>
                </motion.div>
              ))}
            </motion.nav>

            <div className="mt-auto flex flex-col gap-2 px-4 pt-8 pb-8 sm:px-6">
              {user ? (
                <div className="flex items-center justify-between gap-4">
                  <span className="body-5 text-muted-foreground">
                    {user.name ?? user.email}
                  </span>
                  <UserMenu user={user} tone="plain" />
                </div>
              ) : (
                <>
                  <CtaLink
                    href={auth.signup.url}
                    className="w-full"
                    size="sm"
                  >
                    {auth.signup.text}
                  </CtaLink>
                  <Link
                    href={auth.login.url}
                    className="button-sm rounded-lg px-3 py-2 text-center text-muted-foreground transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none"
                  >
                    {auth.login.text}
                  </Link>
                </>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
};

/**
 * Two lines that rotate into a cross. Only `transform` changes, so the swap
 * runs on the base curve instead of snapping between two icons.
 */
function ToggleGlyph({ open }: { open: boolean }) {
  const line =
    "absolute left-0 h-0.5 w-5 rounded-full bg-current transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]";

  return (
    <span aria-hidden="true" className="relative block h-4 w-5">
      <span
        className={cn(
          line,
          "top-0",
          open ? "translate-y-2 rotate-45" : "translate-y-0 rotate-0",
        )}
      />
      <span
        className={cn(
          line,
          "bottom-0",
          open ? "-translate-y-2 -rotate-45" : "translate-y-0 rotate-0",
        )}
      />
    </span>
  );
}

export { Navbar };
