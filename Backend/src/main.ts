import "reflect-metadata";

import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";

import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { parseOrigins, resolvePort } from "./config/env";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
  });

  const config = app.get(ConfigService);
  const origins = parseOrigins(config.get<string>("CORS_ORIGINS"));

  // Behind a load balancer this is what makes req.ip (and therefore throttling)
  // reflect the client rather than the proxy.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(
    helmet({
      // Prisma/Supabase do not inline anything here, but a future media proxy
      // will need to be fetched cross-origin.
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  app.enableCors({
    origin: origins.length > 0 ? origins : false,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 86_400,
  });

  app.setGlobalPrefix("api");

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  // A host that routes to `$PORT` (Render, Fly, Heroku) tells us the port to
  // bind; a local .env keeps it on APP_PORT.
  const port = resolvePort(
    config.get<number>("APP_PORT"),
    config.get<number>("PORT"),
  );

  await app.listen(port, "0.0.0.0");

  Logger.log(`API ready on port ${port} (prefix /api)`, "Bootstrap");
}

void bootstrap();
