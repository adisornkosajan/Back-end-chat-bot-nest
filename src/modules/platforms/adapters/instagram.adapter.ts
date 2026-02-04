import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class InstagramAdapter {
  private readonly logger = new Logger(InstagramAdapter.name);

  parseWebhook(payload: any) {
    this.logger.debug('📷 Parsing Instagram webhook');
    
    // Instagram Messaging API webhook structure (2025-2026)
    // Format: { object: 'instagram', entry: [...] }
    if (!payload?.entry?.[0]) {
      this.logger.warn('⚠️ Invalid Instagram webhook payload structure');
      return null;
    }

    const entry = payload.entry[0];
    
    // Instagram uses "messaging" field like Facebook Messenger
    if (entry.messaging && entry.messaging.length > 0) {
      const messaging = entry.messaging[0];

      // Check if it's a message event
      if (!messaging.message) {
        this.logger.debug('🔕 Not a message event, skipping');
        return null;
      }

      const senderId = messaging.sender?.id;
      const recipientId = messaging.recipient?.id; // Instagram Account ID - ใช้หา organization
      const messageId = messaging.message?.mid;
      let messageText = messaging.message?.text || '';
      const attachments = messaging.message?.attachments || [];
      let contentType = 'text';
      let imageUrl: string | undefined = undefined;

      // Check for image attachment
      if (attachments.length > 0) {
        const attachment = attachments[0];
        if (attachment.type === 'image') {
          imageUrl = attachment.payload?.url;
          messageText = messageText || '[Image]';
          contentType = 'image';
        } else {
          contentType = attachment.type;
          messageText = messageText || `[${attachment.type}]`;
        }
      }

      if (!senderId || !messageId || !recipientId) {
        this.logger.warn('⚠️ Missing required fields: senderId, messageId, or recipientId');
        return null;
      }

      this.logger.debug(`✅ Parsed Instagram message from ${senderId} to IG Account ${recipientId}`);

      return {
        platform: 'instagram',
        recipientId: recipientId, // Instagram Account ID
        externalCustomerId: senderId,
        messageId: messageId,
        content: messageText,
        contentType: contentType,
        ...(imageUrl && { imageUrl }),
        raw: payload,
      };
    }
    
    // Instagram also supports "changes" field for comments
    if (entry.changes && entry.changes.length > 0) {
      const change = entry.changes[0];
      
      // Handle comment mentions
      if (change.field === 'comments' && change.value?.text) {
        this.logger.debug('💬 Instagram comment received');
        
        const recipientId = change.value.media?.instagram_account_id || entry.id;
        
        return {
          platform: 'instagram',
          recipientId: recipientId, // Instagram Account ID from comment
          externalCustomerId: change.value.from?.id || change.value.id,
          messageId: change.value.id,
          content: change.value.text,
          contentType: 'comment',
          raw: payload,
        };
      }
    }

    this.logger.debug('🔕 Unhandled Instagram webhook event type');
    return null;
  }
}
