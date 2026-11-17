import type { StaticImageData } from "next/image";

import zestEat from "../../clients/Zest_Eat.png";

export type ClientLogo = {
  /** The client's own name, used for the alt text. */
  name: string;
  logo: StaticImageData;
};

/**
 * Real customer logos, imported from `frontend/clients/`. Static imports give
 * the strip the intrinsic pixel size of each file, so no tile has to guess.
 * Drop another PNG in that folder and add one entry here.
 */
export const clients: ClientLogo[] = [{ name: "Zest Eat", logo: zestEat }];

/**
 * Slots still waiting on a logo file. Rendered as marked placeholders rather
 * than filled with an invented brand.
 */
export const pendingClientSlots = 5;
