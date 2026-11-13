import {
  Controller,
  Get,
  ServiceUnavailableException,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";

import { PrismaService } from "../prisma/prisma.service";

/**
 * Liveness answers "is the process up"; readiness answers "can it serve real
 * traffic". They are separate so a deploy platform can restart a wedged pod
 * without also pulling it out of rotation for a slow database.
 */
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @SkipThrottle()
  liveness() {
    return {
      status: "ok",
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  @Get("readiness")
  @SkipThrottle()
  async readiness() {
    try {
      await this.prisma.ping();
    } catch {
      throw new ServiceUnavailableException({
        status: "error",
        database: "down",
      });
    }

    return {
      status: "ok",
      database: "up",
      timestamp: new Date().toISOString(),
    };
  }
}
