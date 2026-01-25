import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PlatformRegistry } from './platform.registry';
import { PlatformsController } from './platforms.controller';
import { PlatformsService } from './platforms.service';
import { FacebookAdapter } from './adapters/facebook.adapter';
import { InstagramAdapter } from './adapters/instagram.adapter';
import { WhatsAppAdapter } from './adapters/whatsapp.adapter';

@Module({
  imports: [PrismaModule],
  controllers: [PlatformsController],
  providers: [
    PlatformRegistry,
    PlatformsService,
    FacebookAdapter,
    InstagramAdapter,
    WhatsAppAdapter,
  ],
  exports: [PlatformRegistry, PlatformsService],
})
export class PlatformModule {}
