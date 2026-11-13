import { TearFooter } from "@/components/marketing/footer/tear-footer";
import { site } from "@/config/site";

const brandName = site.name.trim() || "Your Company";

/**
 * Resolved once when the module loads. `cacheComponents` rejects reading the
 * clock while rendering, and a copyright year is not more precise than the
 * deploy that produced the page.
 */
const COPYRIGHT_YEAR = new Date().getFullYear();

/**
 * Site-specific wiring for the torn-poster footer. Everything the footer prints
 * — wordmark, email, links, legal — comes from the site config so a rebrand
 * (or a fork for another customer) is one file.
 */
export function SiteFooter() {
  const mailto = `mailto:${site.email}`;

  return (
    <TearFooter
      brand={brandName}
      name="managed WhatsApp automation"
      logoHref="/"
      email={site.email}
      sheet="#ea580c"
      paper="#ffffff"
      sheetInk="#ffffff"
      paperInk="#111111"
      pinColor="#18181b"
      height="100svh"
      socials={[{ icon: "chat", label: "WhatsApp support", href: mailto }]}
      newsletter={{
        label: "product updates, once a month",
        placeholder: "you@company.com",
      }}
      status={{ label: "onboarding new customers", href: mailto }}
      mark="Cloud API / 2026"
      timeZone="Asia/Kolkata"
      timeLabel="IST"
      columns={[
        {
          title: "product",
          links: [
            { label: "Features", href: site.links.features },
            { label: "How it works", href: "/how-it-works" },
            { label: "FAQ", href: "/faq" },
          ],
          cta: { label: "plans.", href: site.links.pricing },
        },
        {
          title: "company",
          links: [
            { label: "Contact", href: site.links.contact },
            { label: "Refund policy", href: site.links.refund },
          ],
          cta: { label: "talk.", href: mailto },
        },
      ]}
      chat={{ label: "say hi", href: mailto }}
      sideLinks={[
        { icon: "shield", label: "privacy", href: site.links.privacy },
        { icon: "doc", label: "terms", href: site.links.terms },
      ]}
      copyright={`© ${COPYRIGHT_YEAR} ${brandName}`}
      credit="managed WhatsApp infrastructure"
      handle={{ label: "Book a walkthrough", href: site.links.contact }}
    />
  );
}
