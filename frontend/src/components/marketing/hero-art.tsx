import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * The hero's picture.
 *
 * `public/Hero.png` is a cutout on transparency, so the mint disc sits behind
 * the person rather than framing a white rectangle: her head clears the top of
 * the circle and the crop takes the body at the bottom, which is how the
 * reference hero holds its subject.
 *
 * The photo is the one thing on this page whose colour the palette does not
 * control — the sweater is yellow — so everything around it stays inside the
 * four token colours and the disc is the only saturated field it touches.
 *
 * The sprig sits in the white corner beside the disc: it is the page's one
 * organic mark, and on a photographic hero it is all the hand-drawn apparatus
 * the composition needs.
 */
export function HeroArt() {
  return (
    <div className="relative mx-auto w-full max-w-[500px]">
      <div
        aria-hidden="true"
        className="absolute inset-x-[2%] top-[6%] aspect-square rounded-full bg-mint"
      />

      <Image
        src="/Hero.png"
        alt="A customer reading a reply on her phone"
        width={1000}
        height={1262}
        sizes="(min-width: 1024px) 500px, (min-width: 640px) 70vw, 92vw"
        priority
        className="relative h-auto w-full"
      />

      <Sprig className="absolute top-[4%] left-[1%] w-[10%] text-brand/45" />
    </div>
  );
}

type GlyphProps = { className?: string };

/**
 * A stem with leaves, drawn once so the hero has one organic mark.
 */
function Sprig({ className }: GlyphProps) {
  return (
    <svg viewBox="0 0 72 72" aria-hidden="true" className={cn("h-auto", className)}>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 64C26 52 38 36 58 10" />
        <path d="M22 52C14 46 14 34 22 28C24 37 24 45 22 52Z" />
        <path d="M32 40C38 30 49 27 56 32C48 37 40 41 32 40Z" />
        <path d="M40 28C35 19 39 10 48 7C49 16 46 24 40 28Z" />
      </g>
    </svg>
  );
}
