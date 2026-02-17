import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class WhatsAppAdapter {
  private readonly logger = new Logger(WhatsAppAdapter.name);

  parseWebhook(payload: any) {
    this.logger.debug('💚 Parsing WhatsApp webhook');
    
    // WhatsApp Business Platform API webhook structure (2025-2026)
    // Format: { object: 'whatsapp_business_account', entry: [...] }
    
    // Check if this is a status update webhook (not a message)
    if (payload?.entry?.[0]?.changes?.[0]?.value?.statuses) {
      this.logger.debug('📊 WhatsApp status update webhook (message delivery status) - skipping');
      return null;
    }
    
    if (!payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
      // Log the actual payload structure for debugging
      this.logger.warn('⚠️ Invalid WhatsApp webhook payload structure');
      this.logger.debug(`Payload structure: ${JSON.stringify({
        hasEntry: !!payload?.entry,
        entryLength: payload?.entry?.length,
        hasChanges: !!payload?.entry?.[0]?.changes,
        changesLength: payload?.entry?.[0]?.changes?.length,
        hasValue: !!payload?.entry?.[0]?.changes?.[0]?.value,
        valueKeys: payload?.entry?.[0]?.changes?.[0]?.value ? Object.keys(payload.entry[0].changes[0].value) : [],
        hasMessages: !!payload?.entry?.[0]?.changes?.[0]?.value?.messages,
      })}`);
      return null;
    }

    const value = payload.entry[0].changes[0].value;
    const message = value.messages[0];
    const metadata = value.metadata;

    const senderId = message.from;
    const messageId = message.id;
    const messageType = message.type || 'text';

    // Get message content based on type
    let messageText = '';
    let contentType = messageType;
    let imageId: string | undefined = undefined;

    switch (messageType) {
      case 'text':
        messageText = message.text?.body || '';
        break;
      case 'image':
        messageText = message.image?.caption || '[Image]';
        contentType = 'image';
        imageId = message.image?.id;
        break;
      case 'video':
        messageText = message.video?.caption || '[Video]';
        contentType = 'video';
        break;
      case 'audio':
        messageText = '[Audio]';
        contentType = 'audio';
        break;
      case 'document':
        messageText = message.document?.filename || '[Document]';
        contentType = 'document';
        break;
      case 'sticker':
        messageText = '[Sticker]';
        contentType = 'sticker';
        break;
      case 'location':
        messageText = `[Location: ${message.location?.latitude}, ${message.location?.longitude}]`;
        contentType = 'location';
        break;
      case 'contacts':
        messageText = '[Contact]';
        contentType = 'contact';
        break;
      case 'interactive':
        // Handle button replies, list replies, etc.
        if (message.interactive?.type === 'button_reply') {
          messageText = message.interactive.button_reply.title;
        } else if (message.interactive?.type === 'list_reply') {
          messageText = message.interactive.list_reply.title;
        }
        contentType = 'interactive';
        break;
      default:
        messageText = `[${messageType}]`;
    }

    if (!senderId || !messageId) {
      this.logger.warn('⚠️ Missing required fields: senderId or messageId');
      return null;
    }

    const recipientId = metadata?.phone_number_id; // Phone Number ID - ใช้หา organization
    if (!recipientId) {
      this.logger.warn('⚠️ Missing Phone Number ID in metadata');
      return null;
    }

    this.logger.debug(`✅ Parsed WhatsApp message from ${senderId} to Phone Number ID ${recipientId}`);

    return {
      platform: 'whatsapp',
      recipientId: recipientId, // Phone Number ID
      externalCustomerId: senderId,
      messageId: messageId,
      content: messageText,
      contentType: contentType,
      ...(imageId && { imageId }),
      raw: payload,
    };
  }
}
