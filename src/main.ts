import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import 'winston-daily-rotate-file';

async function bootstrap() {
  const winstonLogger = WinstonModule.createLogger({
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, context }) => {
            return `[${timestamp}] ${level}: [${context || 'Bootstrap'}] ${message}`;
          }),
        ),
      }),
      new winston.transports.DailyRotateFile({
        filename: 'logs/talk-v-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '14d',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json(),
        ),
      }),
    ],
  });

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: winstonLogger,
    rawBody: true,
  });

  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  const port = config.get<number>('PORT') || 3001;

  logger.log('🚀 Starting Talk-V AI Backend...');

  app.setGlobalPrefix('api');

  // ✅ Serve static uploads (สำคัญ)
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: true,
    credentials: true,
  });

  await app.listen(port);

  logger.log(`🎉 Backend running on: http://localhost:${port}/api`);
  logger.log(`🌍 Public uploads URL should be: https://api.nighttime77.win/uploads/...`);
}

bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error('❌ Application failed to start:', error);
  process.exit(1);
});
