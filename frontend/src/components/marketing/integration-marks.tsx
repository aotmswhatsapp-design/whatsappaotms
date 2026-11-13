import type { SVGProps } from "react";

/**
 * Simplified monochrome marks for the integrations strip. Stroked at 1.8 to
 * match the lucide icons used elsewhere in the app — these are recognisable
 * glyphs, not pixel-accurate reproductions of the vendors' logos.
 */
const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function WhatsAppMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M20.5 11.6a8.5 8.5 0 0 1-12.6 7.5L3.5 20.5l1.5-4.3A8.5 8.5 0 1 1 20.5 11.6Z" />
      <path d="M9.1 8.5c.4 0 .7.2.9.6l.6 1.2c.1.3.1.6-.1.8l-.5.5c-.1.1-.1.3 0 .4.4.8 1.1 1.5 1.9 1.9.1.1.3.1.4 0l.5-.5c.2-.2.5-.2.8-.1l1.2.6c.4.2.6.5.6.9 0 1-.8 1.7-1.7 1.7h-.3c-2.9 0-5.2-2.3-5.2-5.2v-.2c0-1 .7-1.7 1.7-1.7Z" />
    </svg>
  );
}

export function RazorpayMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M7 19.5V4.5h5.3a4.6 4.6 0 0 1 0 9.2H7" />
      <path d="m12.6 13.7 3.6 5.8" />
    </svg>
  );
}

export function OpenAIMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.4 19.4 7.7v8.6L12 20.6 4.6 16.3V7.7L12 3.4Z" />
      <path d="M12 8.1 15.6 10.2v4.2L12 16.5l-3.6-2.1v-4.2L12 8.1Z" />
      <path d="M12 3.4v4.7M19.4 7.7 15.6 10M19.4 16.3 15.6 14.4M12 20.6v-4.1M4.6 16.3l3.8-1.9M4.6 7.7l3.8 2.3" />
    </svg>
  );
}

export function ShopifyMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M5.7 7.6h12.6l.9 12.5H4.8L5.7 7.6Z" />
      <path d="M9.2 7.6V6a2.8 2.8 0 0 1 5.6 0v1.6" />
    </svg>
  );
}

export function SheetsMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-5.5-5.5Z" />
      <path d="M13.5 3.5V9H19" />
      <path d="M9 12.2h6M9 15.4h6M12 12.2v3.2" />
    </svg>
  );
}

export function ZapierMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.6v16.8M4.7 7.8l14.6 8.4M19.3 7.8 4.7 16.2" />
    </svg>
  );
}
