import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class FacebookAdapter {
  private readonly logger = new Logger(FacebookAdapter.name);

  parseWebhook(payload: any) {
    this.logger.debug('📘 Parsing Facebook webhook');
    
    // Validate payload structure
    if (!payload?.entry?.[0]?.messaging?.[0]) {
      this.logger.warn('⚠️ Invalid Facebook webhook payload structure');
      return null;
    }

    const entry = payload.entry[0];
    const messaging = entry.messaging[0];

    // Check if it's a message event
    if (!messaging.message) {
      this.logger.debug('🔕 Not a message event (might be delivery, read, or other), skipping');
      return null;
    }

    const senderId = messaging.sender?.id;
    const recipientId = messaging.recipient?.id; // Page ID - ใช้หา organization
    const messageId = messaging.message?.mid;
    let messageText = messaging.message?.text || '';
    let contentType = 'text';
    let imageUrl: string | undefined = undefined;

    // Check for image attachment
    if (messaging.message?.attachments?.[0]) {
      const attachment = messaging.message.attachments[0];
      if (attachment.type === 'image') {
        imageUrl = attachment.payload?.url;
        messageText = messageText || '[Image]';
        contentType = 'image';
      }
    }

    if (!senderId || !messageId || !recipientId) {
      this.logger.warn('⚠️ Missing required fields: senderId, messageId, or recipientId');
      return null;
    }

    this.logger.debug(`✅ Parsed message from ${senderId} to Page ${recipientId}`);

    return {
      platform: 'facebook',
      recipientId: recipientId, // Page ID
      externalCustomerId: senderId,
      messageId: messageId,
      content: messageText,
      contentType: contentType,
      ...(imageUrl && { imageUrl }),
      raw: payload,
    };
  }
}
