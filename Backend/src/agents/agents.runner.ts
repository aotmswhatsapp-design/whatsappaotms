import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { KnowledgeService } from "./knowledge.service";
import { ReplyService } from "./reply.service";

/**
 * One second, because a reply is a person waiting. Indexing is fast enough at
 * this rate for a handful of uploads, and both kinds of work are claimed
 * atomically, so a second process would only add throughput.
 */
const TICK_MS = 1_000;

/**
 * The process's own work loop: index one source, then answer one run.
 *
 * No queue, no Redis, no worker dyno. The rows are the queue — `PENDING`
 * sources and `QUEUED` runs — and this loop only decides who takes them, which
 * is why the whole thing survives a restart without any bookkeeping.
 */
@Injectable()
export class AgentsRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentsRunner.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly replies: ReplyService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);

    // A background loop must never be the reason the process stays alive.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;

    try {
      // Both recoveries are two-column updates and are what makes a crash
      // mid-call resume instead of leaving a row stuck forever.
      await this.knowledge.recoverStale();
      await this.replies.releaseStale();

      const source = await this.knowledge.claim();
      if (source) await this.knowledge.index(source);

      const run = await this.replies.claim();
      if (run) await this.replies.answer(run);
    } catch (error) {
      // One bad row must not stop the loop: the row already holds its own
      // failure, and the next tick takes the next one.
      this.logger.error(
        `Agent pass failed: ${
          error instanceof Error ? error.message : "unknown failure"
        }`,
      );
    } finally {
      this.busy = false;
    }
  }
}
