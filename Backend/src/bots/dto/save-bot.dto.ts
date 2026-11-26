import { Allow } from "class-validator";

/**
 * The whole flow, replacing whatever was stored.
 *
 * `flow` is accepted as it arrives and read by `flowIn` — the same reader the
 * renderer and the tap router use. A second schema here would let the builder
 * save a shape the runtime cannot read, which is the one failure that would
 * look like a bug in the customer's phone.
 */
export class SaveBotDto {
  @Allow()
  flow!: unknown;
}
