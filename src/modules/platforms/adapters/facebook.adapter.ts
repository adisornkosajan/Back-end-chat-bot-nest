import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class FacebookAdapter {
  private readonly logger = new Logger(FacebookAdapter.name);

  parseWebhook(payload: any) {
    this.logger.debug('Parsing Facebook webhook');

    if (!payload?.entry?.[0]?.messaging?.[0]) {
      this.logger.warn('Invalid Facebook webhook payload structure');
      return null;
    }

    const messaging = payload.entry[0].messaging[0];
    const senderId = messaging.sender?.id;
    const recipientId = messaging.recipient?.id; // Page ID
    const timestamp = messaging.timestamp || Date.now();

    let messageId: string | undefined;
    let messageText = '';
    let contentType = 'text';
    let imageUrl: string | undefined;

    if (messaging.message) {
      messageId = messaging.message?.mid || `fb_msg_${senderId}_${timestamp}`;
      messageText = messaging.message?.text || '';

      if (messaging.message?.quick_reply?.payload) {
        messageText = messaging.message.quick_reply.payload;
        contentType = 'quick_reply';
      }

      if (messaging.message?.attachments?.[0]) {
        const attachment = messaging.message.attachments[0];
        if (attachment.payload?.url) {
          imageUrl = attachment.payload.url;
        }
        if (attachment.type === 'image') {
          messageText = messageText || '[Image]';
          contentType = 'image';
        } else if (attachment.type === 'video') {
          messageText = messageText || '[Video]';
          contentType = 'video';
        } else {
          messageText = messageText || `[${attachment.type}]`;
          contentType = attachment.type || 'file';
        }
      }
    } else if (messaging.postback) {
      messageId = messaging.postback?.mid || `fb_postback_${senderId}_${timestamp}`;
      messageText =
        messaging.postback?.payload || messaging.postback?.title || 'postback';
      contentType = 'postback';
    } else {
      this.logger.debug('Not a message/postback event, skipping');
      return null;
    }

    if (!senderId || !recipientId || !messageId) {
      this.logger.warn('Missing required sender, recipient, or message id');
      return null;
    }

    return {
      platform: 'facebook',
      recipientId,
      externalCustomerId: senderId,
      messageId,
      content: messageText,
      contentType,
      ...(imageUrl && { imageUrl }),
      raw: payload,
    };
  }
}
