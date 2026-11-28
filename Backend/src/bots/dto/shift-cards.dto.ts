import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsString,
  IsUUID,
  MinLength,
} from "class-validator";

import { MAX_CARDS } from "../bot.flow";
import type { ShiftMode } from "../bot.shift";

/**
 * One shift: which cards, to whom, and whether they leave or are copied.
 *
 * The cards travel as ids rather than as cards. The server reads both flows
 * itself, so the body cannot carry a version of a card that is older than the
 * one being moved — the browser would otherwise be able to pin a card the owner
 * has since edited in another tab.
 */
export class ShiftCardsDto {
  @IsUUID(undefined, { message: "Choose the agent to shift the cards to." })
  targetAgentId!: string;

  @IsArray()
  @ArrayMinSize(1, { message: "Choose at least one card to shift." })
  // A flow holds at most this many, so a longer list cannot be one shift out
  // of one flow. Refused here rather than counted twice below.
  @ArrayMaxSize(MAX_CARDS, { message: "Too many cards in one shift." })
  @ArrayUnique({ message: "The same card was chosen twice." })
  @IsString({ each: true })
  @MinLength(1, { each: true, message: "Every card needs an id." })
  cardIds!: string[];

  @IsIn(["move", "copy"])
  mode!: ShiftMode;
}
