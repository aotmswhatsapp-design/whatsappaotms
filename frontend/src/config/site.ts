export const site = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME ?? "",
  description:
    "Managed WhatsApp automation for growing businesses. Campaigns, shared inbox, chatbots, and analytics — provisioned for you.",
  /**
   * Intrinsic pixel size of public/logo.png (720x183, ~3.93:1). Never set a
   * square size here — the navbar sizes it by height and lets width follow.
   */
  logo: {
    src: "/logo.png",
    alt: process.env.NEXT_PUBLIC_BRAND_NAME
      ? `${process.env.NEXT_PUBLIC_BRAND_NAME} logo`
      : "Logo",
    width: 720,
    height: 183,
  },
  links: {
    login: "/login",
    pricing: "/pricing",
    contact: "/contact",
    features: "/features",
    terms: "/legal/terms",
    privacy: "/legal/privacy",
    refund: "/legal/refund-policy",
  },
  /**
   * Contact address shown in the footer and on "ask a question" mail links.
   * Set NEXT_PUBLIC_CONTACT_EMAIL before launch — the default is a placeholder.
   */
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "contact@aotms.com",
} as const;
