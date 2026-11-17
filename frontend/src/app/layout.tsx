import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { site } from "@/config/site";
import "@/styles/globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const brandName = site.name.trim();

/**
 * The brand name is env-driven and may be blank in a bare checkout. Never
 * interpolate it unconditionally, or titles render as "— Managed WhatsApp"
 * and "Pricing · ".
 */
export const metadata: Metadata = {
  // Social images are relative paths, so they need a base to resolve against.
  // Set NEXT_PUBLIC_SITE_URL in production; the fallback matches Next's own.
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: brandName
    ? {
        default: `${brandName} — Managed WhatsApp automation`,
        template: `%s · ${brandName}`,
      }
    : { default: "Managed WhatsApp automation", template: "%s" },
  description: site.description,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
