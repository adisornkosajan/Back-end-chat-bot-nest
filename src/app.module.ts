import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import appConfig from './config/app.config';
import authConfig from './config/auth.config';
import databaseConfig from './config/database.config';
import oauthConfig from './config/oauth.config';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { PlatformModule } from './modules/platforms/platform.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { WebhookModule } from './modules/webhooks/webhook.module';
import { AiModule } from './modules/ai/ai.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, authConfig, databaseConfig, oauthConfig],
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    PlatformModule,
    IntegrationsModule,
    MessagingModule,
    RealtimeModule,
    WebhookModule,
    AiModule,
  ],
})
export class AppModule {}
