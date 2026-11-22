import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { SyncTrigger } from "@prisma/client";

import { AnalyticsSyncService } from "./analytics.sync";

/**
 * Hour (UTC) the daily pull runs. Late enough that Meta has closed the previous
 * day everywhere, early enough that a support shift sees fresh figures when it
 * starts.
 */
const RUN_HOUR_UTC = 2;
const RUN_MINUTE_UTC = 30;

const DAY_MS = 86_400_000;

/**
 * The daily analytics pull.
 *
 * A timer rather than a queue or a scheduler library: the work is one pass per
 * day over a handful of accounts, and a dependency that owns a background
 * worker would be more moving parts than the job is worth. The schedule is
 * anchored to a fixed UTC time instead of a rolling 24-hour interval so a
 * restart cannot slowly walk the run into the middle of Meta's day.
 *
 * One limitation this cannot solve at the application layer: on a host that
 * sleeps an idle instance, a timer only fires while the instance is awake. The
 * Sync button is the fallback, and the screen always shows when the last
 * successful run actually happened rather than implying the timer ran.
 */
@Injectable()
export class AnalyticsScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly sync: AnalyticsSyncService) {}

  onApplicationBootstrap(): void {
    this.arm();
  }

  onModuleDestroy(): void {
    this.stopped = true;

    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Runs the pull now. Exposed so a test or an operator can trigger it. */
  async runOnce(): Promise<void> {
    this.logger.log("Daily analytics sync starting.");

    try {
      const result = await this.sync.syncAll(SyncTrigger.SCHEDULED);

      this.logger.log(
        `Daily analytics sync finished: ${result.ok}/${result.workspaces} ok, ${result.failed} failed.`,
      );
    } catch (error) {
      // The timer must survive a bad night; the per-run rows already carry the
      // reason, so this is the last line of defence, not the reporting path.
      this.logger.error(
        `Daily analytics sync could not run: ${
          error instanceof Error ? error.message : "unexpected failure"
        }`,
      );
    }
  }

  private arm(): void {
    if (this.stopped) return;

    const delay = msUntilNextRun();

    this.timer = setTimeout(() => {
      void this.runOnce().finally(() => this.arm());
    }, delay);

    // Never hold the process open on account of a timer.
    this.timer.unref?.();

    this.logger.log(
      `Next analytics sync in ${Math.round(delay / 60_000)} minutes.`,
    );
  }
}

/** Milliseconds from now until the next HH:30 UTC. */
export function msUntilNextRun(now = new Date()): number {
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      RUN_HOUR_UTC,
      RUN_MINUTE_UTC,
      0,
      0,
    ),
  );

  if (next.getTime() <= now.getTime()) {
    return next.getTime() + DAY_MS - now.getTime();
  }

  return next.getTime() - now.getTime();
}
