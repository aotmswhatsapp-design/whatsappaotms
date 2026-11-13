"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { Book, Menu, Sunset, Trees, Zap } from "lucide-react";
import { motion } from "motion/react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useOriginFill } from "@/components/ui/use-origin-fill";
import { site } from "@/config/site";
import type { SessionUser } from "@/lib/auth/types";
import { cn } from "@/lib/utils";
import { UserMenu } from "@/components/account/user-menu";

interface MenuItem {
  title: string;
  url: string;
  description?: string;
  icon?: React.ReactNode;
  items?: MenuItem[];
}

interface NavbarProps {
  logo?: {
    url: string;
    src: string;
    alt: string;
    title: string;
  };
  menu?: MenuItem[];
  mobileExtraLinks?: {
    name: string;
    url: string;
  }[];
  auth?: {
    login: {
      text: string;
      url: string;
    };
    signup: {
      text: string;
      url: string;
    };
  };
  /**
   * Signed-in user, resolved by the layout inside a Suspense boundary. `null`
   * or omitted renders the Log in / Get started pair instead.
   */
  user?: SessionUser | null;
}

/**
 * logo.png is a wide lockup (720x183) in navy, so on the orange sheet it sits
 * on a small white plate — the same treatment the login screen uses, and the
 * only way the mark keeps any contrast here.
 */
const BrandLogo = ({ logo }: { logo: NonNullable<NavbarProps["logo"]> }) => (
  <Link
    href={logo.url}
    className="group flex items-center gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#a54013]"
  >
    <span className="rounded-md bg-white px-2 py-1 shadow-sm transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-md">
      <Image    
        src={logo.src}
        alt={logo.alt}
        width={site.logo.width}
        height={site.logo.height}
        className="h-10 w-auto"
      />
    </span>
    {logo.title ? (
      <span className="text-lg font-semibold tracking-tight text-white">
        {logo.title}
      </span>
    ) : null}
  </Link>
);

const Navbar = ({
  logo = {
    url: "/",
    src: site.logo.src,
    alt: site.logo.alt,
    title: site.name,
  },
  menu = [
    {
      title: "Product",
      url: "#",
      items: [
        {
          title: "Campaigns",
          description: "Approved templates to segmented contact lists",
          icon: <Zap className="size-5 shrink-0 text-brand" />,
          url: "/features",
        },
        {
          title: "Shared inbox",
          description: "One place for every customer conversation",
          icon: <Book className="size-5 shrink-0 text-blue" />,
          url: "/features",
        },
        {
          title: "Chatbots",
          description: "Answer routine questions around the clock",
          icon: <Trees className="size-5 shrink-0 text-lime" />,
          url: "/features",
        },
        {
          title: "Analytics",
          description: "Delivery, read rates, and campaign performance",
          icon: <Sunset className="size-5 shrink-0 text-brand" />,
          url: "/features",
        },
      ],
    },
    { title: "How it works", url: "/how-it-works" },
    { title: "Pricing", url: "/pricing" },
    { title: "Contact", url: "/contact" },
  ],
  mobileExtraLinks = [
    { name: "Features", url: "/features" },
    { name: "FAQ", url: "/faq" },
    { name: "Privacy", url: site.links.privacy },
    { name: "Terms", url: site.links.terms },
  ],
  auth = {
    login: { text: "Log in", url: site.links.login },
    signup: { text: "Get started", url: site.links.pricing },
  },
  user = null,
}: NavbarProps) => {
  const authActions = user ? (
    <UserMenu user={user} />
  ) : (
    <>
      <Button asChild variant="inverse-ghost" size="lg">
        <Link href={auth.login.url}>{auth.login.text}</Link>
      </Button>
      <Button asChild variant="light" size="lg">
        <Link href={auth.signup.url}>{auth.signup.text}</Link>
      </Button>
    </>
  );

  return (
    // The header sits directly on the hero: the hero's gradient opens at
    // #9c3a11, but its grain overlay lifts the rendered top edge to about
    // #a54013. Matching the rendered colour — and dropping the divider — is
    // what makes the two read as one sheet.
    <header className="sticky top-0 z-50 bg-[#a54013] text-white">
      <div className="mx-auto w-full max-w-7xl px-5 lg:px-8">
        {/*
          Three tracks keep the menu optically centred in the viewport: the
          logo and the auth actions take equal 1fr rails, so the middle track
          lands on the true centre instead of in the leftover space.
        */}
        <nav className="hidden items-center py-3 lg:grid lg:grid-cols-[1fr_auto_1fr]">
          <div className="flex items-center">
            <BrandLogo logo={logo} />
          </div>
          <div className="flex justify-center">
            <NavigationMenu>
              <NavigationMenuList>
                {menu.map((item) => (
                  <DesktopNavItem item={item} key={item.title} />
                ))}
              </NavigationMenuList>
            </NavigationMenu>
          </div>
          <div className="flex items-center justify-end gap-2">
            {authActions}
          </div>
        </nav>

        <div className="block lg:hidden">
          <div className="flex items-center justify-between py-3">
            <BrandLogo logo={logo} />
            <div className="flex items-center gap-2">
              {user ? <UserMenu user={user} /> : null}
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="inverse" size="icon" aria-label="Open menu">
                    <Menu className="size-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent className="overflow-y-auto">
                  <SheetHeader>
                    <SheetTitle>
                      <span className="rounded-md bg-white px-2 py-1">
                        <Image
                          src={logo.src}
                          alt={logo.alt}
                          width={site.logo.width}
                          height={site.logo.height}
                          className="h-6 w-auto"
                        />
                      </span>
                    </SheetTitle>
                  </SheetHeader>
                  <div className="flex flex-col gap-6 px-4 pb-4">
                    <Accordion
                      type="single"
                      collapsible
                      className="flex w-full flex-col gap-4"
                    >
                      {menu.map((item) => renderMobileMenuItem(item))}
                    </Accordion>
                    <div className="border-t border-border pt-4">
                      <div className="grid grid-cols-2 justify-start gap-1">
                        {mobileExtraLinks.map((link) => (
                          <Link
                            key={link.name}
                            href={link.url}
                            className="inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-accent hover:text-accent-foreground"
                          >
                            {link.name}
                          </Link>
                        ))}
                      </div>
                    </div>
                    {user ? null : (
                      <div className="flex flex-col gap-3">
                        <Button asChild variant="outline">
                          <Link href={auth.login.url}>{auth.login.text}</Link>
                        </Button>
                        <Button asChild variant="brand">
                          <Link href={auth.signup.url}>
                            {auth.signup.text}
                          </Link>
                        </Button>
                      </div>
                    )}
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

const FILL_DURATION = 0.4;
const FILL_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/**
 * The hero's "Start with a plan" hover, reused on the sheet: a white circle
 * grows from wherever the pointer entered and fills the control, so the label
 * can flip to the sheet orange and stay legible on top of it.
 */
const OriginFillLayer = ({
  active,
  coverSize,
  origin,
}: {
  active: boolean;
  coverSize: number;
  origin: { x: number; y: number };
}) => (
  <motion.span
    animate={{ scale: active && coverSize > 0 ? 1 : 0 }}
    aria-hidden="true"
    className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
    initial={false}
    style={{
      height: coverSize,
      left: origin.x,
      top: origin.y,
      width: coverSize,
    }}
    transition={{ duration: FILL_DURATION, ease: FILL_EASE }}
  />
);

const desktopItemBase =
  "relative isolate inline-flex h-9 items-center justify-center overflow-hidden rounded-lg px-3.5 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#a54013]";

// `hover:`/`focus:`/`data-[state=open]:` are spelled out in both states because
// the trigger's base style paints `bg-accent` and a dark foreground on those
// states by default — and its variant rules outrank a plain `text-*` utility.
const desktopItemIdle =
  "text-white/85 hover:text-white focus:text-white data-[state=open]:text-white";
const desktopItemFilled =
  "text-[#9c3a11] hover:text-[#9c3a11] focus:text-[#9c3a11] data-[state=open]:text-[#9c3a11]";

const DesktopNavItem = ({ item }: { item: MenuItem }) =>
  item.items ? <DesktopNavTrigger item={item} /> : <DesktopNavLink item={item} />;

const DesktopNavLink = ({ item }: { item: MenuItem }) => {
  const { active, coverSize, origin, setNode } = useOriginFill({ hover: true });

  return (
    <NavigationMenuItem>
      <Link
        className={cn(
          desktopItemBase,
          active ? desktopItemFilled : desktopItemIdle,
        )}
        href={item.url}
        ref={setNode}
      >
        <OriginFillLayer active={active} coverSize={coverSize} origin={origin} />
        <span className="relative z-10">{item.title}</span>
      </Link>
    </NavigationMenuItem>
  );
};

const DesktopNavTrigger = ({ item }: { item: MenuItem }) => {
  const { active, coverSize, origin, setNode } = useOriginFill({ hover: true });

  return (
    <NavigationMenuItem>
      <NavigationMenuTrigger
        className={cn(
          desktopItemBase,
          "hover:bg-transparent focus:bg-transparent data-[state=open]:bg-white/15",
          active ? desktopItemFilled : desktopItemIdle,
        )}
        ref={setNode}
      >
        {/* The label sits above the fill; the chevron the trigger appends
            follows the fill because it paints later and inherits the colour. */}
        <OriginFillLayer active={active} coverSize={coverSize} origin={origin} />
        <span className="relative z-10">{item.title}</span>
      </NavigationMenuTrigger>
      <NavigationMenuContent>
        <ul className="w-80 space-y-1 p-2">
          {item.items?.map((subItem) => (
            <li key={subItem.title}>
              <Link
                href={subItem.url}
                className="flex select-none gap-3 rounded-lg p-3 leading-none text-foreground outline-none transition-all duration-200 hover:translate-x-0.5 hover:bg-accent"
              >
                {subItem.icon}
                <div>
                  <div className="text-sm font-semibold">{subItem.title}</div>
                  {subItem.description ? (
                    <p className="mt-1 text-sm leading-snug text-muted-foreground">
                      {subItem.description}
                    </p>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </NavigationMenuContent>
    </NavigationMenuItem>
  );
};

const renderMobileMenuItem = (item: MenuItem) => {
  if (item.items) {
    return (
      <AccordionItem
        key={item.title}
        value={item.title}
        className="border-b-0"
      >
        <AccordionTrigger className="py-0 font-semibold hover:no-underline">
          {item.title}
        </AccordionTrigger>
        <AccordionContent className="mt-2 pb-0">
          {item.items.map((subItem) => (
            <Link
              key={subItem.title}
              href={subItem.url}
              className="flex select-none gap-3 rounded-md p-3 leading-none outline-none transition-all duration-200 hover:translate-x-0.5 hover:bg-accent"
            >
              {subItem.icon}
              <div>
                <div className="text-sm font-semibold">{subItem.title}</div>
                {subItem.description ? (
                  <p className="mt-1 text-sm leading-snug text-muted-foreground">
                    {subItem.description}
                  </p>
                ) : null}
              </div>
            </Link>
          ))}
        </AccordionContent>
      </AccordionItem>
    );
  }

  return (
    <Link
      key={item.title}
      href={item.url}
      className="rounded-md py-1 font-semibold transition-colors duration-200 hover:text-brand"
    >
      {item.title}
    </Link>
  );
};

export { Navbar };
