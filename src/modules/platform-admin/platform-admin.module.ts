import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { LicensingModule } from '../licensing/licensing.module';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformBootstrapController } from './platform-bootstrap.controller';
import { PlatformAdminService } from './platform-admin.service';

@Module({
  imports: [
    LicensingModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') || 'default-secret',
      }),
    }),
  ],
  controllers: [PlatformAdminController, PlatformBootstrapController],
  providers: [PlatformAdminService],
  exports: [PlatformAdminService],
})
export class PlatformAdminModule {}
