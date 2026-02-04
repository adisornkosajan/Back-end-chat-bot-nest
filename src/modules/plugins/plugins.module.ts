import { Module } from '@nestjs/common';
import { PluginsController } from './plugins.controller';
import { PluginsService } from './plugins.service';
import { PluginEngineService } from './plugin-engine.service';
import { QRCodeService } from './qrcode.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PluginsController],
  providers: [PluginsService, PluginEngineService, QRCodeService],
  exports: [PluginsService, PluginEngineService, QRCodeService],
})
export class PluginsModule {}
