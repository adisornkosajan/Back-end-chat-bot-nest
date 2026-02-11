import { Module } from '@nestjs/common';
import { PluginsController } from './plugins.controller';
import { PluginsService } from './plugins.service';
import { PluginEngineService } from './plugin-engine.service';
import { QRCodeService } from './qrcode.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { LicensingModule } from '../licensing/licensing.module';
import { FeatureGuard } from '../../common/guards/feature.guard';

@Module({
  imports: [PrismaModule, LicensingModule],
  controllers: [PluginsController],
  providers: [PluginsService, PluginEngineService, QRCodeService, FeatureGuard],
  exports: [PluginsService, PluginEngineService, QRCodeService],
})
export class PluginsModule {}
