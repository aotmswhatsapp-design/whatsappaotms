import Image from "next/image";
import { Plus } from "@phosphor-icons/react/dist/ssr";

import { clients, type ClientLogo } from "@/config/clients";
import { cn } from "@/lib/utils";

/** Four across from `md`, two on a phone; two rows, always a whole rectangle. */
const COLUMNS = 4;
const ROWS = 2;
const CELLS = COLUMNS * ROWS;

/**
 * Customer logos in a bordered lattice rather than in floating cards.
 *
 * The grid is the page's hairline taken to its logical end: the section reads
 * as a table of accounts instead of a row of chips, and the plus marks sit on
 * the interior junctions the way a technical drawing notates a join.
 *
 * The palette supplies both tints. `background` and `secondary` are a
 * checkerboard in the band scope — the light blue field against its own
 * quarter-step — so the lattice needs no fifth colour to separate the cells.
 *
 * A client with no logo yet keeps its tile and shows the placeholder text: the
 * rectangle is drawn to the grid's size, so the section never reflows when the
 * next file arrives.
 */
export function LogoStrip() {
  const cells: (ClientLogo | null)[] = [
    ...clients.slice(0, CELLS),
    ...Array.from({ length: Math.max(0, CELLS - clients.length) }, () => null),
  ];

  return (
    <section
      aria-label="Customers"
      data-theme="band"
      className="border-b border-border bg-background/75"
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 lg:py-16">
        <p className="caption-2 text-center text-muted-foreground">
          Teams that run their WhatsApp channel with us
        </p>

        {/* Borders live on the outside (top and left) and on every cell (right
            and bottom), so the lattice closes without drawing any line twice. */}
        <div className="relative mt-8 grid grid-cols-2 border-t border-l border-border md:grid-cols-4">
          {cells.map((client, index) => {
            const row = Math.floor(index / COLUMNS);
            const column = index % COLUMNS;

            return (
              <div
                key={client?.name ?? `pending-${index}`}
                className={cn(
                  "flex h-24 items-center justify-center border-r border-b border-border px-4 md:h-28",
                  (row + column) % 2 === 0 ? "bg-secondary" : "bg-background",
                )}
              >
                {client ? (
                  <Image
                    src={client.logo}
                    alt={`${client.name} logo`}
                    sizes="(min-width: 768px) 25vw, 50vw"
                    loading="lazy"
                    placeholder="blur"
                    /* Both files are opaque with a white background. Multiply
                       drops the white into the cell tint instead of punching a
                       pale rectangle through the lattice. Set as a style rather
                       than a class: this build's Tailwind does not emit the
                       `mix-blend-multiply` utility, so a class here would be a
                       silent no-op. */
                    style={{ mixBlendMode: "multiply" }}
                    className={cn("w-auto object-contain", client.className)}
                  />
                ) : (
                  <span className="caption-4 text-muted-foreground">
                    {"{{customer_logo}}"}
                  </span>
                )}
              </div>
            );
          })}

          {/* Below `md` the grid is two across, so the only junction on screen
              is the centre one. */}
          <Plus
            aria-hidden="true"
            weight="thin"
            className="pointer-events-none absolute top-1/2 left-1/2 size-6 -translate-x-1/2 -translate-y-1/2 text-muted-foreground md:hidden"
          />
          {/* From `md` the interior junctions sit on the row divider. */}
          {[25, 50, 75].map((left) => (
            <Plus
              key={left}
              aria-hidden="true"
              weight="thin"
              style={{ left: `${left}%` }}
              className="pointer-events-none absolute top-1/2 hidden size-6 -translate-x-1/2 -translate-y-1/2 text-muted-foreground md:block"
            />
          ))}
        </div>
      </div>
    </section>
  );
}
