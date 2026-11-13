import Link from "next/link";

import {
  OpenAIMark,
  RazorpayMark,
  SheetsMark,
  ShopifyMark,
  WhatsAppMark,
  ZapierMark,
} from "@/components/marketing/integration-marks";
import { Button } from "@/components/ui/button";
import { site } from "@/config/site";

const integrations = [
  { name: "WhatsApp Business", Mark: WhatsAppMark },
  { name: "Razorpay", Mark: RazorpayMark },
  { name: "OpenAI", Mark: OpenAIMark },
  { name: "Shopify", Mark: ShopifyMark },
  { name: "Google Sheets", Mark: SheetsMark },
  { name: "Zapier", Mark: ZapierMark },
];

export function Integrations() {
  return (
    <section className="border-y border-border bg-muted/40">
      <div className="mx-auto w-full max-w-5xl px-5 py-14 lg:px-8">
        <div className="space-y-6 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-balance">
            Connects with the tools you already run on
          </h2>

          {/* Three per row on phones so the six marks form a tidy 2×3 block,
              then a centred wrap once there is room. */}
          <ul className="mx-auto grid max-w-md grid-cols-3 gap-2 sm:flex sm:max-w-2xl sm:flex-wrap sm:justify-center">
            {integrations.map(({ name, Mark }) => (
              <li
                key={name}
                className="group flex flex-col items-center gap-2 rounded-xl border border-border bg-background px-2 py-4 transition-colors hover:border-brand/40 hover:bg-brand-soft/40 sm:min-w-24 sm:px-4"
                title={name}
              >
                <Mark className="size-7 text-muted-foreground transition-colors group-hover:text-brand" />
                <span className="text-[11px] font-medium text-muted-foreground">
                  {name}
                </span>
              </li>
            ))}
          </ul>

          <Button asChild variant="outline">
            <Link href={site.links.features}>See what syncs both ways</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
