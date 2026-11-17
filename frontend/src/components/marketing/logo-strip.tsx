import Image from "next/image";

import { clients, pendingClientSlots } from "@/config/clients";

/**
 * Customer logos. Each tile is the same size whether it holds a real file or a
 * placeholder, so the row keeps its rhythm while more logos are collected.
 *
 * The strip sits below the fold, so every logo is lazy: the browser only
 * fetches a file as the row comes into view, and the static import gives Next a
 * blur placeholder to hold the tile's shape in the meantime.
 */
export function LogoStrip() {
  return (
    <section aria-label="Customers" className="border-b border-border">
      <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 lg:py-16">
        <p className="caption-2 text-center text-muted-foreground">
          Teams that run their WhatsApp channel with us
        </p>

        <ul className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {clients.map((client) => (
            <li
              key={client.name}
              className="flex h-16 items-center justify-center rounded-xl border border-border bg-card px-4"
            >
              <Image
                src={client.logo}
                alt={`${client.name} logo`}
                sizes="128px"
                loading="lazy"
                placeholder="blur"
                className="max-h-12 w-auto object-contain"
              />
            </li>
          ))}

          {Array.from({ length: pendingClientSlots }, (_, slot) => (
            <li
              key={`pending-${slot}`}
              className="flex h-16 items-center justify-center rounded-xl border border-dashed border-border"
            >
              <span className="caption-4 text-muted-foreground">
                {"{{customer_logo}}"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
