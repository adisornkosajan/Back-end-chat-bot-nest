import { Body, Controller, Param, Post, Logger, Get, Query, Res, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { WebhookService } from './webhook.service';

@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly webhookService: WebhookService) {}

  // Facebook Webhook Verification
  @Get('facebook')
  verifyFacebook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
      this.logger.log('✅ Facebook webhook verified');
      return res.status(HttpStatus.OK).send(challenge);
    }

    this.logger.warn('❌ Facebook webhook verification failed');
    return res.sendStatus(HttpStatus.FORBIDDEN);
  }

  // Instagram Webhook Verification
  @Get('instagram')
  verifyInstagram(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
      this.logger.log('✅ Instagram webhook verified');
      return res.status(HttpStatus.OK).send(challenge);
    }

    this.logger.warn('❌ Instagram webhook verification failed');
    return res.sendStatus(HttpStatus.FORBIDDEN);
  }

  // WhatsApp Webhook Verification
  @Get('whatsapp')
  verifyWhatsApp(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
      this.logger.log('✅ WhatsApp webhook verified');
      return res.status(HttpStatus.OK).send(challenge);
    }

    this.logger.warn('❌ WhatsApp webhook verification failed');
    return res.sendStatus(HttpStatus.FORBIDDEN);
  }

  // Unified Meta Webhook Verification (for all platforms)
  @Get('meta')
  verifyMeta(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
      this.logger.log('✅ Meta webhook verified');
      return res.status(HttpStatus.OK).send(challenge);
    }

    this.logger.warn('❌ Meta webhook verification failed');
    return res.sendStatus(HttpStatus.FORBIDDEN);
  }

  @Post(':platform')
  async receive(@Param('platform') platform: string, @Body() payload: any) {
    this.logger.log(`📨 Webhook received from ${platform.toUpperCase()}`);
    this.logger.debug(
      `Payload: ${JSON.stringify(payload).substring(0, 200)}...`,
    );
    try {
      await this.webhookService.handle(platform, payload);
      this.logger.log(`✅ Webhook processed successfully for ${platform}`);
      return { status: 'ok' };
    } catch (error) {
      this.logger.error(
        `❌ Webhook processing failed for ${platform}:`,
        error.message,
      );
      throw error;
    }
  }
}
