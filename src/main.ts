import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  logger.log('🚀 Starting Talk-V AI Backend...');
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  const port = config.get<number>('PORT') || 3001;
  const corsOrigin = config.get<string>('CORS_ORIGIN') || '*';

  logger.log('⚙️  Configuring application...');
  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  logger.log('✅ Global validation pipe configured');

  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });
  logger.log(`✅ CORS enabled for origin: ${corsOrigin}`);

  await app.listen(port);
  logger.log(`🎉 Application is running on: http://localhost:${port}/api`);
  logger.log(`🔌 WebSocket available at: ws://localhost:${port}`);
}

bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error('❌ Application failed to start:', error);
  process.exit(1);
});
