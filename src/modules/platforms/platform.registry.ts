import { Injectable, Logger } from '@nestjs/common';
import { FacebookAdapter } from './adapters/facebook.adapter';
import { InstagramAdapter } from './adapters/instagram.adapter';
import { WhatsAppAdapter } from './adapters/whatsapp.adapter';

@Injectable()
export class PlatformRegistry {
  private readonly logger = new Logger(PlatformRegistry.name);

  constructor(
    private readonly facebook: FacebookAdapter,
    private readonly instagram: InstagramAdapter,
    private readonly whatsapp: WhatsAppAdapter,
  ) {
    this.logger.log('📱 Platform Registry initialized with adapters: Facebook, Instagram, WhatsApp');
  }

  getAdapter(type: string) {
    this.logger.debug(`🔍 Getting adapter for platform: ${type}`);
    switch (type) {
      case 'facebook':
        this.logger.debug('✅ Returning Facebook adapter');
        return this.facebook;
      case 'instagram':
        this.logger.debug('✅ Returning Instagram adapter');
        return this.instagram;
      case 'whatsapp':
        this.logger.debug('✅ Returning WhatsApp adapter');
        return this.whatsapp;
      default:
        this.logger.error(`❌ Unsupported platform: ${type}`);
        throw new Error(`Unsupported platform: ${type}`);
    }
  }
}
