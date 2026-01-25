import { Injectable, Logger } from '@nestjs/common';
import { PlatformRegistry } from '../platforms/platform.registry';
import { MessagingService } from '../messaging/messaging.service';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly registry: PlatformRegistry,
    private readonly messaging: MessagingService,
  ) {}

  async handle(platform: string, payload: any) {
    this.logger.log(`🎣 Handling webhook for platform: ${platform}`);
    try {
      const adapter = this.registry.getAdapter(platform);
      this.logger.debug(`📦 Adapter retrieved for ${platform}`);
      
      const normalized = adapter.parseWebhook(payload);
      
      // If adapter returns null, it means the event should be ignored
      if (!normalized) {
        this.logger.debug('🙄 Webhook event ignored (not a processable message)');
        return;
      }
      
      this.logger.debug(`🔄 Webhook data normalized: ${JSON.stringify(normalized).substring(0, 100)}...`);
      
      await this.messaging.processInbound(normalized);
      this.logger.log(`✅ Webhook handled successfully for ${platform}`);
    } catch (error) {
      this.logger.error(`❌ Error handling webhook for ${platform}:`, error.message);
      throw error;
    }
  }
}
