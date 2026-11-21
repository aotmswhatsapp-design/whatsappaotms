import type { StaticImageData } from "next/image";

import zestEat from "../../clients/Zest_Eat.png";
import pare from "../../clients/PARE.png";

export type ClientLogo = {
  /** The client's own name, used for the alt text. */
  name: string;
  logo: StaticImageData;
  /**
   * Cap for the file's own framing. The two files carry very different amounts
   * of white space — one fills its canvas with the mark, the other is a
   * wordmark sitting in wide margins — so a single height rule would render
   * one of them at roughly half the optical size of the other.
   */
  className?: string;
};

/**
 * Real customer logos, imported from `frontend/clients/`. Static imports give
 * the strip the intrinsic pixel size of each file, so no tile has to guess.
 * Drop another PNG in that folder and add one entry here: the grid replaces a
 * pending tile with it.
 */
export const clients: ClientLogo[] = [
  { name: "Zest Eat", logo: zestEat, className: "max-h-14" },
  { name: "PARE", logo: pare, className: "max-h-[84px]" },
];
