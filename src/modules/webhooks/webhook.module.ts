import { Module } from '@nestjs/common';
import { PlatformModule } from '../platforms/platform.module';

import { WebhookController } from './webhook.controller';
import { MessagingModule } from '../messaging/messaging.module';
import { WebhookService } from './webhook.service';
@Module({
  imports: [PlatformModule, MessagingModule],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule {}
