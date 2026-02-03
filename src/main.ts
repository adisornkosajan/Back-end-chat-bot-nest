import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import 'winston-daily-rotate-file';

async function bootstrap() {
  // --- การตั้งค่า Winston Logger ---
  const winstonLogger = WinstonModule.createLogger({
    transports: [
      // 1. แสดงผลบน Console (แบบมีสีสัน)
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, context }) => {
            return `[${timestamp}] ${level}: [${context || 'Bootstrap'}] ${message}`;
          }),
        ),
      }),
      // 2. บันทึกเป็นไฟล์ (แยกตามวัน และเก็บไว้ 14 วัน)
      new winston.transports.DailyRotateFile({
        filename: 'logs/talk-v-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m', // ขนาดไฟล์สูงสุด
        maxFiles: '14d', // เก็บย้อนหลัง 14 วัน
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json(), // ในไฟล์เก็บเป็น JSON เพื่อให้เอาไปวิเคราะห์ต่อง่าย
        ),
      }),
    ],
  });

  // ใช้ winstonLogger แทน Logger ปกติของ Nest
  const app = await NestFactory.create(AppModule, {
    logger: winstonLogger,
  });

  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap'); // เรียกใช้งานผ่าน Logger ปกติได้เลย แต่มันจะใช้ไส้ในเป็น Winston แล้ว

  const port = config.get<number>('PORT') || 3001;
  const corsOrigin = config.get<string>('CORS_ORIGIN') || '*';

  logger.log('🚀 Starting Talk-V AI Backend...');
  
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });

  await app.listen(port);
  logger.log(`🎉 Application is running on: http://localhost:${port}/api`);
  logger.log(`🔌 WebSocket available at: ws://localhost:${port}`);
}

bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error('❌ Application failed to start:', error);
  process.exit(1);
});