import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class InstagramAdapter {
  private readonly logger = new Logger(InstagramAdapter.name);

  parseWebhook(payload: any) {
    this.logger.debug('Parsing Instagram webhook');

    if (!payload?.entry?.[0]) {
      this.logger.warn('Invalid Instagram webhook payload structure');
      return null;
    }

    const entry = payload.entry[0];

    if (entry.messaging && entry.messaging.length > 0) {
      const messaging = entry.messaging[0];
      const senderId = messaging.sender?.id;
      const recipientId = messaging.recipient?.id; // Instagram Account ID
      const timestamp = messaging.timestamp || Date.now();

      let messageId: string | undefined;
      let messageText = '';
      let contentType = 'text';
      let imageUrl: string | undefined;

      if (messaging.message) {
        messageId = messaging.message?.mid || `ig_msg_${senderId}_${timestamp}`;
        messageText = messaging.message?.text || '';

        if (messaging.message?.quick_reply?.payload) {
          messageText = messaging.message.quick_reply.payload;
          contentType = 'quick_reply';
        }

        const attachments = messaging.message?.attachments || [];
        if (attachments.length > 0) {
          const attachment = attachments[0];
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
            contentType = attachment.type || 'file';
            messageText = messageText || `[${attachment.type}]`;
          }
        }
      } else if (messaging.postback) {
        messageId = messaging.postback?.mid || `ig_postback_${senderId}_${timestamp}`;
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
        platform: 'instagram',
        recipientId,
        externalCustomerId: senderId,
        messageId,
        content: messageText,
        contentType,
        ...(imageUrl && { imageUrl }),
        raw: payload,
      };
    }

    if (entry.changes && entry.changes.length > 0) {
      const change = entry.changes[0];

      if (change.field === 'comments' && change.value?.text) {
        const recipientId = change.value.media?.instagram_account_id || entry.id;

        return {
          platform: 'instagram',
          recipientId,
          externalCustomerId: change.value.from?.id || change.value.id,
          messageId: change.value.id,
          content: change.value.text,
          contentType: 'comment',
          raw: payload,
        };
      }
    }

    this.logger.debug('Unhandled Instagram webhook event type');
    return null;
  }
}
