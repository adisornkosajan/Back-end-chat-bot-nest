import { Body, Controller, Param, Post, Logger, Get, Query, Res, HttpStatus, Headers, Req } from '@nestjs/common';
import type { Response } from 'express';
import { WebhookService } from './webhook.service';
import * as crypto from 'crypto';

@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly webhookService: WebhookService) {}

  // ============================
  // Shared Webhook Verification
  // ============================
  private verifyWebhookSubscription(
    platform: string,
    mode: string,
    token: string,
    challenge: string,
    res: Response,
  ) {
    if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
      this.logger.log(`✅ ${platform} webhook verified`);
      return res.status(HttpStatus.OK).send(challenge);
    }

    this.logger.warn(`❌ ${platform} webhook verification failed (mode=${mode}, token_match=${token === process.env.META_WEBHOOK_VERIFY_TOKEN})`);
    return res.sendStatus(HttpStatus.FORBIDDEN);
  }

  // ============================
  // Webhook Signature Verification (X-Hub-Signature-256)
  // ============================
  private verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!signature) {
      this.logger.warn('⚠️ No X-Hub-Signature-256 header present');
      return false;
    }

    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret) {
      this.logger.error('❌ META_APP_SECRET not configured — cannot verify webhook signature');
      return false;
    }

    const expectedSignature = 'sha256=' + crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');

    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature),
    );

    if (!isValid) {
      this.logger.warn('❌ Webhook signature mismatch — possible spoofed request');
    }

    return isValid;
  }

  // ============================
  // GET — Webhook Verification Endpoints
  // ============================

  @Get('facebook')
  verifyFacebook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    return this.verifyWebhookSubscription('Facebook', mode, token, challenge, res);
  }

  @Get('instagram')
  verifyInstagram(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    return this.verifyWebhookSubscription('Instagram', mode, token, challenge, res);
  }

  @Get('whatsapp')
  verifyWhatsApp(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    return this.verifyWebhookSubscription('WhatsApp', mode, token, challenge, res);
  }

  @Get('meta')
  verifyMeta(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    return this.verifyWebhookSubscription('Meta', mode, token, challenge, res);
  }

  // ============================
  // POST — Webhook Receive Endpoint (with signature verification)
  // ============================

  @Post(':platform')
  async receive(
    @Param('platform') platform: string,
    @Body() payload: any,
    @Headers('x-hub-signature-256') signature: string,
    @Req() req: any,
  ) {
    this.logger.log(`📨 Webhook received from ${platform.toUpperCase()}`);
    this.logger.debug(
      `Payload: ${JSON.stringify(payload).substring(0, 200)}...`,
    );

    // Verify webhook signature
    const rawBody = req.rawBody;
    if (rawBody && !this.verifySignature(rawBody, signature)) {
      this.logger.error(`🚫 Rejected ${platform} webhook: invalid signature`);
      return { status: 'error', message: 'Invalid signature' };
    }

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
