import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { CampaignsEngine } from "./campaigns.engine";

/** How often the runner looks for work. */
const TICK_MS = 5_000;

/**
 * Drives the send engine.
 *
 * `setInterval` in the process is the whole scheduler. It is enough because the
 * database — not this timer — holds the state: whoever wakes up first claims the
 * campaign, and a process that died simply has its claims expire. The timer is
 * `unref`'d so a one-shot script that boots the app can still exit.
 */
@Injectable()
export class CampaignsRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CampaignsRunner.name);
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(private readonly engine: CampaignsEngine) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass. Never throws: a failed tick must not kill the interval. */
  async tick(): Promise<void> {
    if (this.busy) return;

    this.busy = true;

    try {
      await this.engine.claimDue();
      await this.engine.releaseStale();

      for (const campaign of await this.engine.running()) {
        await this.engine.drain(campaign);
      }
    } catch (error) {
      this.logger.error(`Campaign tick failed: ${String(error)}`);
    } finally {
      this.busy = false;
    }
  }
}
