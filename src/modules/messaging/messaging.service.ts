import {
  BadRequestException,
  Injectable,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AiService } from '../ai/ai.service';
import { PluginEngineService } from '../plugins/plugin-engine.service';
import { ChatbotFlowsService } from '../chatbot-flows/chatbot-flows.service';
import { FlowEngineService } from '../chatbot-flows/flow-engine.service';
import { AutoAssignRulesService } from '../auto-assign-rules/auto-assign-rules.service';
import axios from 'axios';
import FormData = require('form-data');

type FlowQuickReplyOption = {
  title: string;
  payload: string;
};

type FlowButtonOption = {
  type: 'postback' | 'web_url';
  title: string;
  payload?: string;
  url?: string;
};

type FlowCarouselCard = {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  buttons?: FlowButtonOption[];
};

type PendingReplyAliasesState = {
  aliases: Record<string, string>;
  expiresAt: string;
};

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly aiService: AiService,
    private readonly pluginEngine: PluginEngineService,
    private readonly chatbotFlowsService: ChatbotFlowsService,
    private readonly flowEngine: FlowEngineService,
    private readonly autoAssignRulesService: AutoAssignRulesService,
  ) {}

  private extractPlatformMessageId(responseData: any): string | undefined {
    if (!responseData) return undefined;
    if (typeof responseData.message_id === 'string')
      return responseData.message_id;
    if (
      Array.isArray(responseData.messages) &&
      typeof responseData.messages[0]?.id === 'string'
    ) {
      return responseData.messages[0].id;
    }
    if (typeof responseData.id === 'string') return responseData.id;
    return undefined;
  }

  async processInbound(data: {
    platform: string;
    recipientId: string; // Page ID / IG Account ID / Phone Number ID
    externalCustomerId: string;
    messageId: string;
    content: string;
    contentType: string;
    imageUrl?: string; // For Facebook
    imageId?: string; // For WhatsApp
    raw: any;
  }) {
    this.logger.log(`💬 Processing inbound message from ${data.platform}`);
    this.logger.debug(
      `Customer: ${data.externalCustomerId}, Content: ${data.content.substring(0, 50)}...`,
    );

    // 🔒 CRITICAL: ใช้ recipientId หา platform เพื่อป้องกัน data leakage ระหว่าง organizations
    // recipientId คือ:
    // - Facebook: Page ID ที่รับข้อความ
    // - Instagram: Instagram Account ID ที่รับข้อความ
    // - WhatsApp: Phone Number ID ที่รับข้อความ

    // ✅ FIX: ใช้ pageId ใน query โดยตรงเพื่อให้ได้ platform ที่ถูกต้อง
    const platform = await this.prisma.platform.findFirst({
      where: {
        type: data.platform,
        pageId: data.recipientId,
        isActive: true,
      },
      orderBy: {
        createdAt: 'desc', // ถ้ามีหลายตัว (ไม่ควรเกิด) เอาตัวล่าสุด
      },
    });

    if (!platform) {
      this.logger.warn(
        `⚠️ Platform not found: ${data.platform} with recipientId: ${data.recipientId}`,
      );
      return;
    }
    this.logger.debug(
      `✅ Platform found: ${platform.id} (Organization: ${platform.organizationId})`,
    );

    let customer = await this.prisma.customer.findFirst({
      where: {
        platformId: platform.id,
        externalId: data.externalCustomerId,
      },
    });

    if (!customer) {
      this.logger.log(`👤 Creating new customer: ${data.externalCustomerId}`);

      // ดึงข้อมูล profile จาก Facebook/Instagram
      let customerName = data.externalCustomerId;
      try {
        const profileResponse = await axios.get(
          `https://graph.facebook.com/v21.0/${data.externalCustomerId}`,
          {
            params: {
              access_token: platform.accessToken,
              fields: 'id,name,first_name,last_name,profile_pic',
            },
          },
        );

        if (profileResponse.data?.name) {
          customerName = profileResponse.data.name;
          this.logger.debug(`📝 Fetched customer name: ${customerName}`);
        }
      } catch (error) {
        this.logger.debug(`⚠️ Could not fetch profile: ${error.message}`);
      }

      customer = await this.prisma.customer.create({
        data: {
          organizationId: platform.organizationId,
          platformId: platform.id,
          externalId: data.externalCustomerId,
          name: customerName,
        },
      });
    } else {
      this.logger.debug(`Customer found: ${customer.id}`);
    }

    let conversation = await this.prisma.conversation.findFirst({
      where: {
        customerId: customer.id,
        platformId: platform.id,
      },
    });

    if (!conversation) {
      this.logger.log(
        `Creating new conversation for customer: ${customer.id}`,
      );
      conversation = await this.prisma.conversation.create({
        data: {
          organizationId: platform.organizationId,
          platformId: platform.id,
          customerId: customer.id,
        },
      });
    } else {
      this.logger.debug(`Conversation found: ${conversation.id}`);
    }

    let flowInputContent = data.content;
    const conversationFlowState = this.toFlowStateObject(
      (conversation as any).flowState,
    );
    const pendingReplyAliases = conversationFlowState.pendingReplyAliases;

    // Map plain-text reply (e.g. "A") to payload from last interactive message.
    if (!conversationFlowState.awaitingVariable && data.contentType === 'text') {
      const mappedPayload = this.resolvePendingReplyPayload(
        data.content,
        pendingReplyAliases,
      );

      if (mappedPayload) {
        flowInputContent = this.normalizeStructuredPayload(mappedPayload);
        this.logger.debug(
          `Mapped text reply "${data.content}" -> payload "${mappedPayload}"`,
        );

        const { pendingReplyAliases: _unused, ...nextFlowState } =
          conversationFlowState;
        const flowStateToSave =
          Object.keys(nextFlowState).length > 0 ? nextFlowState : null;

        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { flowState: flowStateToSave } as any,
        });
        conversation = { ...conversation, flowState: flowStateToSave as any };
      } else if (
        pendingReplyAliases &&
        this.isPendingReplyAliasesExpired(pendingReplyAliases)
      ) {
        const { pendingReplyAliases: _unused, ...nextFlowState } =
          conversationFlowState;
        const flowStateToSave =
          Object.keys(nextFlowState).length > 0 ? nextFlowState : null;

        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { flowState: flowStateToSave } as any,
        });
        conversation = { ...conversation, flowState: flowStateToSave as any };
      }
    }

    this.logger.log(`Creating message in conversation: ${conversation.id}`);

    if (data.messageId) {
      const existingMessage = await this.prisma.message.findFirst({
        where: {
          organizationId: platform.organizationId,
          conversationId: conversation.id,
          platformMessageId: data.messageId,
        },
      });

      if (existingMessage) {
        this.logger.warn(
          `Duplicate inbound message skipped: ${data.messageId} (conversation: ${conversation.id})`,
        );
        return;
      }
    }
    // Download and convert image to base64 if imageUrl or imageId provided
    let imageBase64: string | null = null;

    if (data.imageUrl) {
      // Facebook/Instagram - download from URL
      try {
        this.logger.debug(`📥 Downloading image from URL: ${data.imageUrl}`);
        const imageResponse = await axios.get(data.imageUrl, {
          responseType: 'arraybuffer',
        });
        const buffer = Buffer.from(imageResponse.data, 'binary');
        const contentType =
          imageResponse.headers['content-type'] || 'image/jpeg';
        imageBase64 = `data:${contentType};base64,${buffer.toString('base64')}`;
        this.logger.debug(`✅ Image downloaded and converted to base64`);
      } catch (error) {
        this.logger.error(`❌ Failed to download image: ${error.message}`);
      }
    } else if (data.imageId && platform.accessToken) {
      // WhatsApp - download using Media ID
      try {
        this.logger.debug(
          `📥 Downloading WhatsApp image with ID: ${data.imageId}`,
        );

        // First, get the media URL
        const mediaResponse = await axios.get(
          `https://graph.facebook.com/v21.0/${data.imageId}`,
          {
            headers: {
              Authorization: `Bearer ${platform.accessToken}`,
            },
          },
        );

        const mediaUrl = mediaResponse.data.url;

        // Then download the actual media
        const imageResponse = await axios.get(mediaUrl, {
          headers: {
            Authorization: `Bearer ${platform.accessToken}`,
          },
          responseType: 'arraybuffer',
        });

        const buffer = Buffer.from(imageResponse.data, 'binary');
        const contentType =
          imageResponse.headers['content-type'] || 'image/jpeg';
        imageBase64 = `data:${contentType};base64,${buffer.toString('base64')}`;
        this.logger.debug(
          `✅ WhatsApp image downloaded and converted to base64`,
        );
      } catch (error) {
        this.logger.error(
          `❌ Failed to download WhatsApp image: ${error.message}`,
        );
      }
    }

    const messageData: any = {
      organizationId: platform.organizationId,
      conversationId: conversation.id,
      senderType: 'customer',
      platformMessageId: data.messageId,
      content: data.content,
      contentType: data.contentType,
      rawPayload: data.raw,
    };

    if (imageBase64) {
      messageData.imageUrl = imageBase64;
    }

    const message = await this.prisma.message.create({
      data: messageData,
    });

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

    this.logger.log(`✅ Message processed successfully: ${message.id}`);

    this.realtime.emitNewMessage(
      platform.organizationId,
      conversation.id,
      message,
    );

    // 🔄 Auto-Assign Rule Engine: ตรวจสอบกฎ auto-assign
    console.log(
      'Checking auto-assign rules...assignedAgentId:',
      conversation.assignedAgentId,
    );
    if (!conversation.assignedAgentId) {
      try {
        const assignAgentId = await this.autoAssignRulesService.evaluateRules(
          platform.organizationId,
          flowInputContent,
          platform.type,
        );
        if (assignAgentId) {
          this.logger.log(
            `🎯 Auto-assign rule matched: assigning to agent ${assignAgentId}`,
          );
          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: { assignedAgentId: assignAgentId, status: 'IN_PROGRESS' },
          });
          conversation = { ...conversation, assignedAgentId: assignAgentId };
        }
      } catch (error) {
        this.logger.error(`❌ Auto-assign rule error: ${error.message}`);
      }
    }

    // 🤖 Chatbot Flow Engine
    let flowResponded = false;
    const isStructuredReplyInput =
      data.contentType === 'quick_reply' ||
      data.contentType === 'postback' ||
      data.contentType === 'interactive' ||
      flowInputContent !== data.content;

    if (
      data.contentType === 'quick_reply' ||
      data.contentType === 'postback' ||
      data.contentType === 'interactive'
    ) {
      flowInputContent = this.normalizeStructuredPayload(flowInputContent);
    }

    // 1. Check for Active Flow (Waiting for Input)
    if (
      conversation.activeFlowId &&
      conversation.activeFlowNodeId &&
      !conversation.flowResumeAt
    ) {
      this.logger.log(`🔄 Resuming active flow for conv: ${conversation.id}`);
      const flowResult = await this.flowEngine.continueFlow(
        conversation.id,
        flowInputContent,
      );

      if (flowResult && flowResult.messages.length > 0) {
        flowResponded = true;
        await this.handleFlowExecutionResult(
          platform,
          conversation,
          customer,
          flowResult,
        );
      }
    }
    // 2. Check for New Flow Trigger (if no active flow)
    else if (!conversation.activeFlowId) {
      const matchingFlow = await this.chatbotFlowsService.findMatchingFlow(
        platform.organizationId,
        flowInputContent,
      );
      console.log('Matching flow:', matchingFlow);
      if (matchingFlow) {
        this.logger.log(`🔀 Chatbot flow matched: ${matchingFlow.name}`);
        const flowResult = await this.flowEngine.executeFlow(matchingFlow, {
          customerMessage: flowInputContent,
          customerId: customer.id,
          platform,
          conversationId: conversation.id,
          organizationId: platform.organizationId,
        });

        if (flowResult && flowResult.messages.length > 0) {
          flowResponded = true;
          await this.handleFlowExecutionResult(
            platform,
            conversation,
            customer,
            flowResult,
          );
        }
      }
    }

    // 🔌 Plugin System: รัน plugins ที่เปิดใช้งาน (ถ้า flow ไม่ได้ตอบ)
    let pluginResponded = false;
    if (!flowResponded) {
      pluginResponded = await this.runPlugins(
        platform,
        conversation,
        customer,
        message,
      );
    }

    // 🤖 AI Auto-Reply: ตอบกลับอัตโนมัติด้วย AI (ถ้า Flow และ Plugin ไม่ได้ตอบ)
    if (!flowResponded && !pluginResponded && !isStructuredReplyInput) {
      await this.sendAiAutoReply(
        platform,
        conversation,
        customer,
        data.content,
      );
    } else {
      this.logger.log(
        `⏭️ Skipping AI auto-reply because ${flowResponded ? 'chatbot flow' : pluginResponded ? 'plugin' : 'structured reply input'} already handled`,
      );
    }
  }

  private truncateText(value: string, maxLength: number) {
    if (!value) return '';
    return value.length > maxLength ? value.slice(0, maxLength) : value;
  }

  private toMetaButtons(buttons: FlowButtonOption[] = []) {
    return buttons
      .map((button) => {
        const type = button.type === 'web_url' ? 'web_url' : 'postback';
        const title = this.truncateText((button.title || '').trim(), 20);

        if (!title) return null;

        if (type === 'web_url') {
          const url = (button.url || '').trim();
          if (!url) return null;
          return { type: 'web_url', title, url };
        }

        const payload = this.truncateText((button.payload || '').trim(), 1000);
        if (!payload) return null;
        return { type: 'postback', title, payload };
      })
      .filter((button): button is NonNullable<typeof button> => !!button);
  }

  private async sendMetaApiMessage(
    platform: any,
    recipientId: string,
    messagePayload: any,
  ): Promise<string | undefined> {
    const pageToken = platform.accessToken;
    if (!pageToken) {
      throw new Error(`${platform.type} access token not found`);
    }

    const response = await axios.post(
      'https://graph.facebook.com/v21.0/me/messages',
      {
        messaging_type: 'RESPONSE',
        recipient: { id: recipientId },
        message: messagePayload,
      },
      {
        params: { access_token: pageToken },
      },
    );

    return this.extractPlatformMessageId(response.data);
  }

  private async sendMetaQuickRepliesMessage(
    platform: any,
    recipientId: string,
    text: string,
    quickReplies: FlowQuickReplyOption[],
  ): Promise<string | undefined> {
    const normalizedQuickReplies = (quickReplies || [])
      .map((reply) => ({
        content_type: 'text',
        title: this.truncateText((reply.title || '').trim(), 20),
        payload: this.truncateText((reply.payload || '').trim(), 1000),
      }))
      .filter((reply) => reply.title && reply.payload)
      .slice(0, 13);

    if (normalizedQuickReplies.length === 0) {
      return undefined;
    }

    const quickReplyText = this.truncateText(
      (text || 'Please choose an option:').trim(),
      640,
    );

    return this.sendMetaApiMessage(platform, recipientId, {
      text: quickReplyText,
      quick_replies: normalizedQuickReplies,
    });
  }

  private async sendMetaButtonTemplateMessage(
    platform: any,
    recipientId: string,
    text: string,
    buttons: FlowButtonOption[],
  ): Promise<string | undefined> {
    const normalizedButtons = this.toMetaButtons(buttons).slice(0, 3);
    if (normalizedButtons.length === 0) {
      return undefined;
    }

    const buttonText = this.truncateText(
      (text || 'Please choose an option:').trim(),
      640,
    );

    return this.sendMetaApiMessage(platform, recipientId, {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button',
          text: buttonText,
          buttons: normalizedButtons,
        },
      },
    });
  }

  private async sendMetaCarouselTemplateMessage(
    platform: any,
    recipientId: string,
    cards: FlowCarouselCard[],
    introText?: string,
  ): Promise<string | undefined> {
    const normalizedCards = (cards || [])
      .map((card) => {
        const title = this.truncateText((card.title || '').trim(), 80);
        if (!title) return null;

        const subtitle = card.subtitle
          ? this.truncateText(card.subtitle.trim(), 80)
          : undefined;
        const imageUrl = (card.imageUrl || '').trim() || undefined;
        const buttons = this.toMetaButtons(card.buttons || []).slice(0, 3);

        return {
          title,
          ...(subtitle ? { subtitle } : {}),
          ...(imageUrl ? { image_url: imageUrl } : {}),
          ...(buttons.length > 0 ? { buttons } : {}),
        };
      })
      .filter((card): card is NonNullable<typeof card> => !!card)
      .slice(0, 10);

    if (normalizedCards.length === 0) {
      return undefined;
    }

    let platformMessageId: string | undefined;

    if (introText?.trim()) {
      platformMessageId = await this.sendMetaApiMessage(platform, recipientId, {
        text: this.truncateText(introText.trim(), 640),
      });
    }

    const carouselMessageId = await this.sendMetaApiMessage(
      platform,
      recipientId,
      {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'generic',
            elements: normalizedCards,
          },
        },
      },
    );

    return carouselMessageId || platformMessageId;
  }

  private async sendWhatsAppApiMessage(
    platform: any,
    recipientPhone: string,
    payload: Record<string, any>,
  ): Promise<string | undefined> {
    const phoneNumberId = platform.pageId;
    const accessToken = platform.accessToken;

    if (!phoneNumberId || !accessToken) {
      throw new Error('WhatsApp credentials not found');
    }

    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: recipientPhone,
        ...payload,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      },
    );

    return this.extractPlatformMessageId(response.data);
  }

  private toWhatsAppReplyOptions(
    quickReplies: FlowQuickReplyOption[],
    buttons: FlowButtonOption[],
  ) {
    const options: Array<{ id: string; title: string }> = [];
    const seenIds = new Set<string>();

    const addOption = (title?: string, payload?: string) => {
      const normalizedTitle = this.truncateText((title || '').trim(), 20);
      const normalizedPayload = this.truncateText(
        this.normalizeStructuredPayload(payload || ''),
        256,
      );
      if (!normalizedTitle || !normalizedPayload) return;
      if (seenIds.has(normalizedPayload)) return;

      seenIds.add(normalizedPayload);
      options.push({
        id: normalizedPayload,
        title: normalizedTitle,
      });
    };

    quickReplies.forEach((reply) => addOption(reply.title, reply.payload));

    buttons.forEach((button) => {
      if (button.type === 'postback') {
        addOption(button.title, button.payload);
      }
    });

    return options;
  }

  private async sendWhatsAppInteractiveReplyOptions(
    platform: any,
    recipientPhone: string,
    text: string,
    options: Array<{ id: string; title: string }>,
  ): Promise<string | undefined> {
    const bodyText = this.truncateText(
      (text || 'Please choose an option:').trim(),
      1024,
    );
    const normalizedOptions = options.filter((option) => option.id && option.title);

    if (normalizedOptions.length === 0) {
      return undefined;
    }

    if (normalizedOptions.length <= 3) {
      return this.sendWhatsAppApiMessage(platform, recipientPhone, {
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText },
          action: {
            buttons: normalizedOptions.slice(0, 3).map((option) => ({
              type: 'reply',
              reply: {
                id: option.id,
                title: option.title,
              },
            })),
          },
        },
      });
    }

    return this.sendWhatsAppApiMessage(platform, recipientPhone, {
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: bodyText },
        action: {
          button: 'Choose option',
          sections: [
            {
              title: 'Options',
              rows: normalizedOptions.slice(0, 10).map((option) => ({
                id: option.id,
                title: this.truncateText(option.title, 24),
              })),
            },
          ],
        },
      },
    });
  }

  private buildInteractiveFallbackText(
    text: string,
    quickReplies: FlowQuickReplyOption[],
    buttons: FlowButtonOption[],
    carousel: FlowCarouselCard[],
  ) {
    const lines: string[] = [];

    if (text?.trim()) {
      lines.push(text.trim());
    }

    if (quickReplies.length > 0) {
      lines.push('Options:');
      quickReplies.forEach((reply, index) => {
        if (reply.title && reply.payload) {
          lines.push(`${index + 1}. ${reply.title}`);
        }
      });
    }

    if (buttons.length > 0) {
      const hasOnlyLinks = buttons.every(
        (button) => button.type === 'web_url' && !!button.url,
      );
      lines.push(hasOnlyLinks ? 'Links:' : 'Buttons:');
      buttons.forEach((button, index) => {
        if (!button.title) return;
        if (button.type === 'web_url' && button.url) {
          lines.push(`${index + 1}. ${button.title}: ${button.url}`);
          return;
        }
        if (button.payload) {
          lines.push(`${index + 1}. ${button.title}`);
        }
      });
    }

    if (carousel.length > 0) {
      lines.push('Cards:');
      carousel.forEach((card, cardIndex) => {
        if (!card.title) return;
        lines.push(`${cardIndex + 1}. ${card.title}`);
        if (card.subtitle) {
          lines.push(`   ${card.subtitle}`);
        }
        (card.buttons || []).forEach((button, buttonIndex) => {
          if (!button.title) return;
          if (button.type === 'web_url' && button.url) {
            lines.push(`   - ${buttonIndex + 1}) ${button.title}: ${button.url}`);
            return;
          }
          if (button.payload) {
            lines.push(`   - ${buttonIndex + 1}) ${button.title}`);
          }
        });
      });
    }

    return lines.join('\n').trim();
  }

  private toFlowStateObject(flowState: any): Record<string, any> {
    if (!flowState || typeof flowState !== 'object' || Array.isArray(flowState)) {
      return {};
    }
    return { ...(flowState as Record<string, any>) };
  }

  private normalizeReplyAliasKey(input: string) {
    return (input || '')
      .trim()
      .toLowerCase()
      .replace(/[).:]+$/g, '')
      .replace(/\s+/g, ' ');
  }

  private normalizeStructuredPayload(input: string) {
    return (input || '').replace(/^payload\s*:\s*/i, '').trim();
  }

  private buildPendingReplyAliases(
    quickReplies: FlowQuickReplyOption[],
    buttons: FlowButtonOption[],
    carousel: FlowCarouselCard[],
  ): PendingReplyAliasesState | null {
    const aliases: Record<string, string> = {};

    const addAlias = (title?: string, payload?: string) => {
      const normalizedTitle = this.normalizeReplyAliasKey(title || '');
      const normalizedPayload = (payload || '').trim();
      if (!normalizedTitle || !normalizedPayload) return;
      aliases[normalizedTitle] = normalizedPayload;
    };

    quickReplies.forEach((reply) => addAlias(reply.title, reply.payload));

    buttons.forEach((button) => {
      if (button.type === 'postback') {
        addAlias(button.title, button.payload);
      }
    });

    carousel.forEach((card) => {
      (card.buttons || []).forEach((button) => {
        if (button.type === 'postback') {
          addAlias(button.title, button.payload);
        }
      });
    });

    if (Object.keys(aliases).length === 0) return null;

    return {
      aliases,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  private isPendingReplyAliasesExpired(aliasState: any) {
    if (!aliasState || typeof aliasState !== 'object') return true;
    const expiresAt = aliasState.expiresAt;
    if (!expiresAt || typeof expiresAt !== 'string') return true;

    const expiresAtMs = Date.parse(expiresAt);
    if (Number.isNaN(expiresAtMs)) return true;

    return Date.now() > expiresAtMs;
  }

  private resolvePendingReplyPayload(content: string, aliasState: any) {
    if (!aliasState || typeof aliasState !== 'object') return null;
    if (this.isPendingReplyAliasesExpired(aliasState)) return null;

    const aliases = aliasState.aliases;
    if (!aliases || typeof aliases !== 'object') return null;

    const normalizedInput = this.normalizeReplyAliasKey(content || '');
    if (!normalizedInput) return null;

    const payload = aliases[normalizedInput];
    if (!payload || typeof payload !== 'string') return null;

    return payload;
  }

  /**
   * Helper to send messages from Flow Result
   */
  async handleFlowExecutionResult(
    platform: any,
    conversation: any,
    customer: any,
    flowResult: any,
  ) {
    if (!flowResult.responded) return;

    for (const msg of flowResult.messages) {
      const msgText = msg.text || '';
      let msgImageUrl = msg.imageUrl;
      const msgLocation = msg.location;
      const msgQuickReplies = Array.isArray(msg.quickReplies)
        ? msg.quickReplies
        : [];
      const msgButtons = Array.isArray(msg.buttons) ? msg.buttons : [];
      const msgCarousel = Array.isArray(msg.carousel) ? msg.carousel : [];

      // Resolve relative upload paths to full URLs for platform APIs
      if (msgImageUrl && msgImageUrl.startsWith('/uploads')) {
        msgImageUrl = `https://api.nighttime77.win${msgImageUrl}`;
      }

      const hasInteractiveContent =
        msgQuickReplies.length > 0 || msgButtons.length > 0 || msgCarousel.length > 0;

      if (hasInteractiveContent) {
        let platformMessageId: string | undefined;

        if (platform.type === 'facebook' || platform.type === 'instagram') {
          if (msgCarousel.length > 0) {
            platformMessageId = await this.sendMetaCarouselTemplateMessage(
              platform,
              customer.externalId,
              msgCarousel,
              msgText,
            );
          } else if (msgButtons.length > 0) {
            platformMessageId = await this.sendMetaButtonTemplateMessage(
              platform,
              customer.externalId,
              msgText,
              msgButtons,
            );
          } else {
            platformMessageId = await this.sendMetaQuickRepliesMessage(
              platform,
              customer.externalId,
              msgText,
              msgQuickReplies,
            );
          }
        } else if (platform.type === 'whatsapp') {
          const whatsappReplyOptions = this.toWhatsAppReplyOptions(
            msgQuickReplies,
            msgButtons,
          );
          const webUrlButtons = msgButtons.filter(
            (button) => button.type === 'web_url' && button.url,
          );

          if (whatsappReplyOptions.length > 0) {
            platformMessageId = await this.sendWhatsAppInteractiveReplyOptions(
              platform,
              customer.externalId,
              msgText || 'Please choose an option:',
              whatsappReplyOptions,
            );
          }

          if (webUrlButtons.length > 0 || msgCarousel.length > 0) {
            const extraFallbackText = this.buildInteractiveFallbackText(
              '',
              [],
              webUrlButtons,
              msgCarousel,
            );

            if (extraFallbackText) {
              const fallbackMessageId = await this.sendWhatsAppMessage(
                platform,
                customer.externalId,
                extraFallbackText,
              );
              platformMessageId = fallbackMessageId || platformMessageId;
            }
          }
        } else {
          const fallbackText = this.buildInteractiveFallbackText(
            msgText,
            msgQuickReplies,
            msgButtons,
            msgCarousel,
          );

          if (fallbackText) {
            platformMessageId = await this.sendPlatformMessage(
              platform,
              customer.externalId,
              fallbackText,
              'text',
            );
          }
        }

        const interactiveSummary =
          msgText ||
          (msgCarousel.length > 0
            ? `Carousel (${msgCarousel.length} cards)`
            : msgButtons.length > 0
              ? `Buttons (${msgButtons.length})`
              : `Quick replies (${msgQuickReplies.length})`);

        const interactiveMessage = await this.prisma.message.create({
          data: {
            organizationId: platform.organizationId,
            conversationId: conversation.id,
            senderType: 'agent',
            content: interactiveSummary,
            contentType: 'interactive',
            platformMessageId,
            rawPayload: {
              quickReplies: msgQuickReplies,
              buttons: msgButtons,
              carousel: msgCarousel,
            },
          },
        });
        this.realtime.emitNewMessage(
          platform.organizationId,
          conversation.id,
          interactiveMessage,
        );

        const pendingAliases = this.buildPendingReplyAliases(
          msgQuickReplies,
          msgButtons,
          msgCarousel,
        );
        if (pendingAliases) {
          const nextFlowState = {
            ...this.toFlowStateObject((conversation as any).flowState),
            pendingReplyAliases: pendingAliases,
          };

          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: { flowState: nextFlowState } as any,
          });
          conversation = { ...conversation, flowState: nextFlowState as any };
        }

        continue;
      }

      // Send Text
      if (msgText && msgText.trim()) {
        await this.sendPlatformMessage(
          platform,
          customer.externalId,
          msgText,
          'text',
        );
        const textMessage = await this.prisma.message.create({
          data: {
            organizationId: platform.organizationId,
            conversationId: conversation.id,
            senderType: 'agent',
            content: msgText,
            contentType: 'text',
          },
        });
        this.realtime.emitNewMessage(
          platform.organizationId,
          conversation.id,
          textMessage,
        );
      }

      // Send Image
      if (msgImageUrl) {
        await this.sendPlatformMessage(
          platform,
          customer.externalId,
          msgImageUrl,
          'image',
        );
        const imageMessage = await this.prisma.message.create({
          data: {
            organizationId: platform.organizationId,
            conversationId: conversation.id,
            senderType: 'agent',
            content: '',
            contentType: 'image',
            imageUrl: msgImageUrl,
          },
        });
        this.realtime.emitNewMessage(
          platform.organizationId,
          conversation.id,
          imageMessage,
        );
      }

      // Send Location
      // Send Location
      if (msgLocation) {
        const mapsUrl = `https://www.google.com/maps?q=${msgLocation.latitude},${msgLocation.longitude}`;

        if (platform.type === 'whatsapp') {
          await this.sendWhatsAppLocation(
            platform,
            customer.externalId,
            msgLocation.latitude,
            msgLocation.longitude,
            msgLocation.name,
            msgLocation.address,
          );
        } else {
          // Facebook / Instagram
          await this.sendPlatformMessage(
            platform,
            customer.externalId,
            mapsUrl,
            'text',
          );
        }

        const locationMessage = await this.prisma.message.create({
          data: {
            organizationId: platform.organizationId,
            conversationId: conversation.id,
            senderType: 'agent',
            content: mapsUrl,
            contentType: 'location',
          },
        });

        this.realtime.emitNewMessage(
          platform.organizationId,
          conversation.id,
          locationMessage,
        );
      }
    }

    // Execute actions
    for (const action of flowResult.actions) {
      if (action.action === 'request_human') {
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { requestHuman: true },
        });
      } else if (action.action === 'close') {
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            status: 'RESOLVED',
            activeFlowId: null,
            activeFlowNodeId: null,
          },
        });
      }
    }
  }

  /**
   * Unified send method (Simplified)
   */
  async sendPlatformMessage(
    platform: any,
    recipientId: string,
    content: string,
    type: 'text' | 'image',
  ) {
    if (type === 'text') {
      if (platform.type === 'facebook')
        return this.sendFacebookMessage(platform, recipientId, content);
      if (platform.type === 'instagram')
        return this.sendInstagramMessage(platform, recipientId, content);
      if (platform.type === 'whatsapp')
        return this.sendWhatsAppMessage(platform, recipientId, content);
    } else if (type === 'image') {
      if (platform.type === 'facebook')
        return this.sendFacebookMessage(platform, recipientId, '', content);
      if (platform.type === 'instagram')
        return this.sendInstagramMessage(platform, recipientId, '', content);
      if (platform.type === 'whatsapp')
        return this.sendWhatsAppMessage(platform, recipientId, '', content);
    }
  }

  /**
   * Public method for Scheduler to send messages
   */
  async sendFlowMessages(conversationId: string, messages: any[]) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { platform: true, customer: true },
    });
    if (!conversation) return;

    const flowResult = { responded: true, messages, actions: [] };
    await this.handleFlowExecutionResult(
      conversation.platform,
      conversation,
      conversation.customer,
      flowResult,
    );
  }

  async getConversations(
    organizationId: string,
    assignedTo?: string,
    status?: string,
  ) {
    const where: any = { organizationId };

    // Filter by assigned agent
    if (assignedTo) {
      if (assignedTo === 'unassigned') {
        where.assignedAgentId = null;
      } else if (assignedTo === 'me') {
        // ต้องส่ง user ID จาก frontend
        where.assignedAgentId = assignedTo;
      } else {
        where.assignedAgentId = assignedTo;
      }
    }

    // Filter by status
    if (status) {
      where.status = status;
    }

    return this.prisma.conversation.findMany({
      where,
      include: {
        customer: true,
        platform: true,
      },
      orderBy: {
        lastMessageAt: 'desc',
      },
    });
  }

  async getMessages(organizationId: string, conversationId: string) {
    return this.prisma.message.findMany({
      where: {
        organizationId,
        conversationId,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async sendAgentMessage(
    organizationId: string,
    conversationId: string,
    content: string,
    agentId: any,
    file?: Express.Multer.File,
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        organizationId,
      },
      include: {
        customer: true,
        platform: true,
      },
    });

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    if (!conversation.platform?.isActive) {
      throw new BadRequestException({
        message:
          'This channel is disconnected. Reconnect the page/account in Connections before sending messages.',
        code: 'PLATFORM_DISCONNECTED',
        platform: conversation.platform?.type,
        pageId: conversation.platform?.pageId,
      });
    }

    const text = typeof content === 'string' ? content.trim() : '';
    if (!file && !text) {
      throw new Error('Message content is required');
    }

    // Auto-assign conversation to agent if not assigned yet
    if (!conversation.assignedAgentId && agentId) {
      this.logger.log(
        `🎯 Auto-assigning conversation ${conversationId} to agent ${agentId}`,
      );
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          assignedAgentId: agentId,
          status: 'IN_PROGRESS',
        },
      });
    }
    // Allow team collaboration - any team member can reply
    // No need to restrict to assigned agent only

    // Get accessToken directly from platform (not from credentials JSON)
    const pageToken = conversation.platform.accessToken;
    if (!pageToken) {
      this.logger.error('❌ Platform accessToken missing');
      throw new Error('Platform credentials not configured');
    }

    const recipientId = conversation.customer.externalId;
    const platformType = conversation.platform.type;

    let imageUrl: string | null = null;
    let platformMessageId: string | undefined;
    const isVideoFile = Boolean(file?.mimetype?.startsWith('video/'));

    // 1️⃣ ส่งไปยัง Platform
    try {
      if (file) {
        // Convert media to base64 for storage
        const base64Image = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
        imageUrl = base64Image;

        // Upload media to platform
        if (platformType === 'facebook' || platformType === 'instagram') {
          // For Facebook/Instagram, we need to send as attachment
          // Using imported FormData
          const formData = new FormData();
          formData.append('messaging_type', 'RESPONSE');
          formData.append('recipient', JSON.stringify({ id: recipientId }));
          formData.append(
            'message',
            JSON.stringify({
              attachment: {
                type: isVideoFile ? 'video' : 'image',
                payload: {
                  is_reusable: true,
                },
              },
            }),
          );
          formData.append('filedata', file.buffer, {
            filename: file.originalname,
            contentType: file.mimetype,
          });

          const mediaResponse = await axios.post(
            'https://graph.facebook.com/v21.0/me/messages',
            formData,
            {
              params: { access_token: pageToken },
              headers: formData.getHeaders(),
            },
          );
          platformMessageId =
            this.extractPlatformMessageId(mediaResponse.data) ||
            platformMessageId;

          // Send text if provided
          if (text) {
            const textResponse = await axios.post(
              'https://graph.facebook.com/v21.0/me/messages',
              {
                messaging_type: 'RESPONSE',
                recipient: { id: recipientId },
                message: { text },
              },
              {
                params: { access_token: pageToken },
              },
            );
            platformMessageId =
              this.extractPlatformMessageId(textResponse.data) ||
              platformMessageId;
          }
        } else if (platformType === 'whatsapp') {
          const phoneNumberId = conversation.platform.pageId;
          // Using imported FormData
          const formData = new FormData();
          formData.append('messaging_product', 'whatsapp');
          formData.append('file', file.buffer, {
            filename: file.originalname,
            contentType: file.mimetype,
          });

          // Upload image first
          const uploadResponse = await axios.post(
            `https://graph.facebook.com/v21.0/${phoneNumberId}/media`,
            formData,
            {
              headers: {
                ...formData.getHeaders(),
                Authorization: `Bearer ${pageToken}`,
              },
            },
          );

          const mediaId = uploadResponse.data.id;

          // Send media message
          if (isVideoFile) {
            const sendResponse = await axios.post(
              `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
              {
                messaging_product: 'whatsapp',
                to: recipientId,
                type: 'video',
                video: { id: mediaId, caption: text || '' },
              },
              {
                headers: {
                  Authorization: `Bearer ${pageToken}`,
                  'Content-Type': 'application/json',
                },
              },
            );
            platformMessageId =
              this.extractPlatformMessageId(sendResponse.data) ||
              platformMessageId;
          } else {
            const sendResponse = await axios.post(
              `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
              {
                messaging_product: 'whatsapp',
                to: recipientId,
                type: 'image',
                image: { id: mediaId, caption: text || '' },
              },
              {
                headers: {
                  Authorization: `Bearer ${pageToken}`,
                  'Content-Type': 'application/json',
                },
              },
            );
            platformMessageId =
              this.extractPlatformMessageId(sendResponse.data) ||
              platformMessageId;
          }
        }
      } else {
        // Text only message
        if (platformType === 'facebook') {
          const sendResponse = await axios.post(
            'https://graph.facebook.com/v21.0/me/messages',
            {
              messaging_type: 'RESPONSE',
              recipient: { id: recipientId },
              message: { text },
            },
            {
              params: { access_token: pageToken },
            },
          );
          platformMessageId =
            this.extractPlatformMessageId(sendResponse.data) ||
            platformMessageId;
        } else if (platformType === 'instagram') {
          const sendResponse = await axios.post(
            'https://graph.facebook.com/v21.0/me/messages',
            {
              messaging_type: 'RESPONSE',
              recipient: { id: recipientId },
              message: { text },
            },
            {
              params: { access_token: pageToken },
            },
          );
          platformMessageId =
            this.extractPlatformMessageId(sendResponse.data) ||
            platformMessageId;
        } else if (platformType === 'whatsapp') {
          const phoneNumberId = conversation.platform.pageId;
          const sendResponse = await axios.post(
            `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
            {
              messaging_product: 'whatsapp',
              to: recipientId,
              type: 'text',
              text: { body: text },
            },
            {
              headers: {
                Authorization: `Bearer ${pageToken}`,
                'Content-Type': 'application/json',
              },
            },
          );
          platformMessageId =
            this.extractPlatformMessageId(sendResponse.data) ||
            platformMessageId;
        } else {
          throw new Error(`Platform ${platformType} not supported yet`);
        }
      }
    } catch (err: any) {
      this.logger.error(`❌ ${platformType.toUpperCase()} Send Error`);
      this.logger.error(
        JSON.stringify({
          status: err?.response?.status,
          data: err?.response?.data,
          message: err?.message,
          config: {
            url: err?.config?.url,
            method: err?.config?.method,
            phoneNumberId:
              platformType === 'whatsapp'
                ? conversation.platform.pageId
                : undefined,
            hasToken: !!pageToken,
          },
        }),
      );
      throw this.mapPlatformSendError(platformType, err);
    }

    // 2️⃣ บันทึก message
    const messageData: any = {
      organizationId,
      conversationId,
      senderType: 'agent',
      content: text,
      contentType: file ? (isVideoFile ? 'video' : 'image') : 'text',
    };

    if (imageUrl) {
      messageData.imageUrl = imageUrl;
    }
    if (platformMessageId) {
      messageData.platformMessageId = platformMessageId;
    }

    const message = await this.prisma.message.create({
      data: messageData,
    });

    // 3️⃣ Realtime broadcast
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    this.realtime.emitNewMessage(organizationId, conversationId, message);

    return message;
  }

  private isOutsideMetaMessagingWindow(error: any): boolean {
    const code = error?.response?.data?.error?.code;
    const subcode = error?.response?.data?.error?.error_subcode;
    return code === 10 && subcode === 2018278;
  }

  private mapPlatformSendError(platformType: string, error: any): Error {
    // Facebook/Instagram permission and token errors
    if (
      (platformType === 'facebook' || platformType === 'instagram') &&
      error?.response?.data?.error
    ) {
      const metaError = error.response.data.error;
      const errorCode = metaError.code;
      const errorMessage = metaError.message || '';

      const missingPermission =
        /pages_messaging|pages_manage_metadata|pages_read_engagement|impersonating a user'?s page/i.test(
          errorMessage,
        );

      if (errorCode === 190 && missingPermission) {
        return new BadRequestException({
          message:
            'Page permission/token is invalid for sending messages. Reconnect this page in Connections and grant all requested Meta permissions.',
          code: 'META_PAGE_PERMISSION_MISSING',
          platform: platformType,
          originalError: errorMessage,
        });
      }

      if (errorCode === 190) {
        return new BadRequestException({
          message:
            'Meta access token is invalid or expired. Reconnect this page/account in Connections.',
          code: 'META_INVALID_TOKEN',
          platform: platformType,
          originalError: errorMessage,
        });
      }
    }

    // WhatsApp-specific errors
    if (platformType === 'whatsapp' && error?.response?.data?.error) {
      const waError = error.response.data.error;
      const errorCode = waError.code;
      const errorMessage = waError.message;

      this.logger.error(
        `📱 WhatsApp API Error - Code: ${errorCode}, Message: ${errorMessage}`,
      );

      // Map common WhatsApp error codes
      if (errorCode === 190) {
        return new BadRequestException({
          message:
            'WhatsApp Access Token has expired or is invalid. Please reconnect WhatsApp in the Connections page.',
          code: 'WHATSAPP_INVALID_TOKEN',
          platform: platformType,
          originalError: errorMessage,
        });
      } else if (errorCode === 131030 || errorCode === 131031) {
        return new BadRequestException({
          message:
            'Invalid WhatsApp recipient phone number. Check the number format and ensure the user has WhatsApp.',
          code: 'WHATSAPP_INVALID_RECIPIENT',
          platform: platformType,
          originalError: errorMessage,
        });
      } else if (errorCode === 100) {
        return new BadRequestException({
          message:
            'WhatsApp API parameter error or missing permission. Check your WhatsApp Business API setup.',
          code: 'WHATSAPP_INVALID_PARAMETER',
          platform: platformType,
          originalError: errorMessage,
        });
      } else if (errorCode === 80007) {
        return new BadRequestException({
          message:
            'Cannot send message: 24-hour messaging window has expired. Customer must message you first or use approved message templates.',
          code: 'WHATSAPP_MESSAGING_WINDOW_EXPIRED',
          platform: platformType,
          originalError: errorMessage,
        });
      }

      // Generic WhatsApp error
      return new BadRequestException({
        message: `WhatsApp API Error: ${errorMessage}`,
        code: `WHATSAPP_ERROR_${errorCode}`,
        platform: platformType,
        originalError: errorMessage,
      });
    }

    // Facebook/Instagram messaging window errors
    if (
      (platformType === 'facebook' || platformType === 'instagram') &&
      this.isOutsideMetaMessagingWindow(error)
    ) {
      return new BadRequestException({
        message:
          'Cannot send this message because the 24-hour messaging window has expired. Ask the customer to message again or use an approved Meta message tag/template.',
        code: 'OUTSIDE_MESSAGING_WINDOW',
        platform: platformType,
      });
    }

    return error;
  }

  async syncFacebookMessages(organizationId: string, platformId: string) {
    this.logger.log(`🔄 Syncing Facebook messages for platform: ${platformId}`);

    const platform = await this.prisma.platform.findUnique({
      where: { id: platformId },
    });

    if (!platform || platform.type !== 'facebook') {
      throw new Error('Invalid Facebook platform');
    }

    const pageAccessToken = platform.accessToken;
    const pageId = platform.pageId;

    try {
      // 1. ดึง conversations จาก Facebook
      const conversationsResponse = await axios.get(
        `https://graph.facebook.com/v21.0/${pageId}/conversations`,
        {
          params: {
            access_token: pageAccessToken,
            fields: 'id,updated_time,participants',
          },
        },
      );

      const fbConversations = conversationsResponse.data.data || [];
      this.logger.log(
        `📋 Found ${fbConversations.length} Facebook conversations`,
      );

      const syncedCount = { conversations: 0, messages: 0 };

      for (const fbConv of fbConversations) {
        try {
          // 2. หา customer จาก participants
          const participants = fbConv.participants?.data || [];
          const customer = participants.find((p: any) => p.id !== pageId);

          if (!customer) continue;

          // 3. สร้างหรือหา Customer ในระบบ
          let dbCustomer = await this.prisma.customer.findFirst({
            where: {
              platformId: platform.id,
              externalId: customer.id,
            },
          });

          // ดึงข้อมูล profile เพิ่มเติมจาก Facebook
          let customerName = customer.name || customer.id;
          let customerEmail = null;
          let customerPhone = null;

          try {
            const profileResponse = await axios.get(
              `https://graph.facebook.com/v21.0/${customer.id}`,
              {
                params: {
                  access_token: pageAccessToken,
                  fields: 'id,name,first_name,last_name,profile_pic',
                },
              },
            );

            if (profileResponse.data) {
              customerName =
                profileResponse.data.name ||
                `${profileResponse.data.first_name || ''} ${profileResponse.data.last_name || ''}`.trim() ||
                customer.id;

              this.logger.debug(`📝 Fetched profile: ${customerName}`);
            }
          } catch (error) {
            this.logger.debug(
              `⚠️ Could not fetch profile for ${customer.id}: ${error.message}`,
            );
          }

          if (!dbCustomer) {
            dbCustomer = await this.prisma.customer.create({
              data: {
                organizationId,
                platformId: platform.id,
                externalId: customer.id,
                name: customerName,
                email: customerEmail,
                phone: customerPhone,
              },
            });
          } else if (dbCustomer.name !== customerName) {
            // Update name if changed
            dbCustomer = await this.prisma.customer.update({
              where: { id: dbCustomer.id },
              data: { name: customerName },
            });
          }

          // 4. สร้างหรือหา Conversation
          let conversation = await this.prisma.conversation.findFirst({
            where: {
              platformId: platform.id,
              customerId: dbCustomer.id,
            },
          });

          if (!conversation) {
            conversation = await this.prisma.conversation.create({
              data: {
                organizationId,
                platformId: platform.id,
                customerId: dbCustomer.id,
                status: 'OPEN',
              },
            });
            syncedCount.conversations++;
          }

          // 5. ดึง messages จาก conversation (with pagination)
          let messagesUrl = `https://graph.facebook.com/v21.0/${fbConv.id}/messages`;
          let hasMore = true;
          let pageCount = 0;
          const maxPages = 10; // จำกัดไม่เกิน 10 หน้า (500 ข้อความ)

          while (hasMore && pageCount < maxPages) {
            const messagesResponse = await axios.get(messagesUrl, {
              params: {
                access_token: pageAccessToken,
                fields: 'id,created_time,from,message',
                limit: 50,
              },
            });

            const fbMessages = messagesResponse.data.data || [];

            // 6. บันทึก messages
            for (const fbMsg of fbMessages) {
              const messageExists = await this.prisma.message.findFirst({
                where: {
                  platformMessageId: fbMsg.id,
                },
              });

              if (!messageExists && fbMsg.message) {
                // แปลง message เป็น string และตัดให้สั้นลงถ้ายาวเกินไป
                let messageContent = '';
                if (typeof fbMsg.message === 'string') {
                  messageContent = fbMsg.message;
                } else if (
                  typeof fbMsg.message === 'object' &&
                  fbMsg.message.text
                ) {
                  messageContent = fbMsg.message.text;
                } else {
                  messageContent = JSON.stringify(fbMsg.message);
                }

                // ตัดข้อความถ้ายาวเกิน 60000 characters (ปลอดภัยสำหรับ TEXT)
                if (messageContent.length > 60000) {
                  messageContent =
                    messageContent.substring(0, 60000) + '... (truncated)';
                }

                await this.prisma.message.create({
                  data: {
                    organizationId,
                    conversationId: conversation.id,
                    platformMessageId: fbMsg.id,
                    senderType: fbMsg.from.id === pageId ? 'agent' : 'customer',
                    content: messageContent,
                    contentType: 'text',
                    rawPayload: fbMsg,
                    sentAt: new Date(fbMsg.created_time),
                  },
                });
                syncedCount.messages++;
              }
            }

            // Check if there's more data
            if (messagesResponse.data.paging?.next) {
              messagesUrl = messagesResponse.data.paging.next;
              pageCount++;
            } else {
              hasMore = false;
            }
          }

          this.logger.debug(`✅ Synced conversation: ${fbConv.id}`);
        } catch (error) {
          this.logger.error(
            `❌ Error syncing conversation ${fbConv.id}:`,
            error.message,
          );
        }
      }

      this.logger.log(
        `🎉 Sync completed: ${syncedCount.conversations} conversations, ${syncedCount.messages} messages`,
      );

      return {
        success: true,
        synced: syncedCount,
      };
    } catch (error: any) {
      this.logger.error(
        '❌ Facebook sync error:',
        error.response?.data || error.message,
      );

      // ถ้าเป็น OAuth error (code 190) ให้ deactivate platform
      if (error.response?.data?.error?.code === 190) {
        this.logger.warn(
          `🔒 Deactivating platform ${platformId} due to invalid/expired token`,
        );
        await this.prisma.platform.update({
          where: { id: platformId },
          data: { isActive: false },
        });
        throw new Error(
          'Platform token expired. Please reconnect your Facebook page.',
        );
      }

      throw new Error('Failed to sync Facebook messages');
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async autoSyncAllPlatforms() {
    this.logger.log('⏰ Auto sync: Starting scheduled sync for all platforms');

    try {
      const platforms = await this.prisma.platform.findMany({
        where: {
          type: 'facebook',
          isActive: true,
        },
      });

      this.logger.log(`📱 Found ${platforms.length} active Facebook platforms`);

      for (const platform of platforms) {
        try {
          await this.syncFacebookMessages(platform.organizationId, platform.id);
        } catch (error) {
          this.logger.error(
            `❌ Auto sync failed for platform ${platform.id}:`,
            error.message,
          );
        }
      }

      this.logger.log('✅ Auto sync completed for all platforms');
    } catch (error) {
      this.logger.error('❌ Auto sync error:', error.message);
    }
  }

  async assignConversation(
    orgId: string,
    agentId: string | null,
    conversationId: string,
  ) {
    this.logger.log(
      `📌 Assigning conversation ${conversationId} to agent: ${agentId || 'unassign'}`,
    );

    // ถ้า agentId เป็น null แสดงว่าต้องการ unassign
    if (agentId === null) {
      return this.prisma.conversation.update({
        where: {
          id: conversationId,
          organizationId: orgId,
        },
        data: {
          assignedAgentId: null,
          status: 'OPEN',
        },
      });
    }

    // Validate agent exists in organization
    const agent = await this.prisma.user.findFirst({
      where: {
        id: agentId,
        organizationId: orgId,
      },
    });

    if (!agent) {
      throw new Error('Agent not found in organization');
    }

    return this.prisma.conversation.update({
      where: {
        id: conversationId,
        organizationId: orgId,
      },
      data: {
        assignedAgentId: agentId,
        status: 'IN_PROGRESS',
      },
    });
  }

  /**
   * Resume AI auto-reply - reset requestHuman flag
   */
  async resumeAI(orgId: string, conversationId: string) {
    this.logger.log(`🤖 Resuming AI for conversation ${conversationId}`);

    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        organizationId: orgId,
      },
    });

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // Update and return full conversation with relations
    return this.prisma.conversation.update({
      where: {
        id: conversationId,
        organizationId: orgId,
      },
      data: {
        requestHuman: false,
      },
      include: {
        customer: true,
        platform: true,
      },
    });
  }

  /**
   * 🔌 รัน plugins ที่เปิดใช้งาน
   * @returns true ถ้า plugin ตอบกลับแล้ว, false ถ้าไม่มี plugin ตอบกลับ
   */
  private async runPlugins(
    platform: any,
    conversation: any,
    customer: any,
    message: any,
  ): Promise<boolean> {
    try {
      this.logger.log(
        `🔌 Running plugins for conversation: ${conversation.id}`,
      );

      // นับจำนวนข้อความใน conversation
      const messageCount = await this.prisma.message.count({
        where: { conversationId: conversation.id },
      });

      // สร้าง context สำหรับ plugins
      const context = {
        message: {
          content: message.content,
          senderId: customer.externalId,
          conversationId: conversation.id,
          platform: platform.type,
        },
        conversation: {
          id: conversation.id,
          isFirstMessage: messageCount === 1, // ข้อความแรกหรือไม่
          messageCount,
        },
        organizationId: platform.organizationId,
      };

      // รัน plugins
      const responses = await this.pluginEngine.executePlugins(context);

      let hasResponse = false;

      // ส่งข้อความตอบกลับจาก plugins
      for (const response of responses) {
        if (response.shouldRespond && response.message) {
          hasResponse = true;
          this.logger.log(
            `📤 Sending plugin response: ${response.message.substring(0, 50)}...`,
          );
          let platformMessageId: string | undefined;

          // ส่งข้อความตามแต่ละ platform
          if (platform.type === 'facebook') {
            platformMessageId = await this.sendFacebookMessage(
              platform,
              customer.externalId,
              response.message,
              response.imageUrl,
            );
          } else if (platform.type === 'instagram') {
            platformMessageId = await this.sendInstagramMessage(
              platform,
              customer.externalId,
              response.message,
              response.imageUrl,
            );
          } else if (platform.type === 'whatsapp') {
            platformMessageId = await this.sendWhatsAppMessage(
              platform,
              customer.externalId,
              response.message,
              response.imageUrl,
            );
          }

          // บันทึกข้อความตอบกลับ
          const pluginMessage = await this.prisma.message.create({
            data: {
              organizationId: platform.organizationId,
              conversationId: conversation.id,
              senderType: 'agent',
              content: response.message,
              contentType: response.imageUrl ? 'image' : 'text',
              platformMessageId,
            },
          });

          // ส่ง real-time update
          this.realtime.emitNewMessage(
            platform.organizationId,
            conversation.id,
            pluginMessage,
          );
        }
      }

      this.logger.log(`✅ Plugins executed: ${responses.length} responses`);
      return hasResponse;
    } catch (error) {
      this.logger.error('Error running plugins:', error);
      return false;
    }
  }

  /**
   * ส่งคำตอบอัตโนมัติจาก AI เมื่อลูกค้าส่งข้อความเข้ามา
   * จะไม่ส่งถ้ามี agent assign หรือมีคนตอบอยู่แล้ว
   */
  private async sendAiAutoReply(
    platform: any,
    conversation: any,
    customer: any,
    customerMessage: string,
  ) {
    try {
      // 🔍 ตรวจสอบว่าลูกค้าขอคุยกับคนหรือไม่ (ต้องเช็คก่อนเพื่อ detect keywords ให้ได้)
      const requestHumanKeywords = [
        'talk to human',
        'speak to human',
        'talk to agent',
        'speak to agent',
        'talk to staff',
        'speak to staff',
        'customer service',
        'human agent',
        'real person',
        'actual person',
        'talk to admin',
        'speak to admin',
        'contact staff',
        'need human',
        'want human',
        'human support',
      ];

      const messageLC = customerMessage.toLowerCase();
      const isRequestingHuman = requestHumanKeywords.some((keyword) =>
        messageLC.includes(keyword.toLowerCase()),
      );

      if (isRequestingHuman) {
        this.logger.log(
          `🙋 Customer requesting human agent for conversation: ${conversation.id}`,
        );

        // อัปเดต conversation flag (แม้จะมี agent assign อยู่แล้วก็อัปเดตได้)
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { requestHuman: true },
        });

        // ตอบกลับว่ากำลังเชื่อมต่อกับเจ้าหน้าที่
        const humanRequestResponse =
          'Please wait a moment. We are connecting you to our staff. 🙏';

        // ส่งข้อความตอบกลับ
        let platformMessageId: string | undefined;
        if (platform.type === 'facebook') {
          platformMessageId = await this.sendFacebookMessage(
            platform,
            customer.externalId,
            humanRequestResponse,
          );
        } else if (platform.type === 'instagram') {
          platformMessageId = await this.sendInstagramMessage(
            platform,
            customer.externalId,
            humanRequestResponse,
          );
        } else if (platform.type === 'whatsapp') {
          platformMessageId = await this.sendWhatsAppMessage(
            platform,
            customer.externalId,
            humanRequestResponse,
          );
        }

        // บันทึกข้อความตอบกลับ
        const aiMessage = await this.prisma.message.create({
          data: {
            organizationId: platform.organizationId,
            conversationId: conversation.id,
            senderType: 'agent',
            content: humanRequestResponse,
            contentType: 'text',
            platformMessageId,
          },
        });

        // ส่ง realtime notification
        this.realtime.emitNewMessage(
          platform.organizationId,
          conversation.id,
          aiMessage,
        );

        this.logger.log(
          `✅ Human request acknowledged and conversation flagged`,
        );
        return; // หยุดไม่ตอบต่อ
      }

      // ✋ ตรวจสอบว่ามี agent assign หรือไม่
      if (conversation.assignedAgentId) {
        this.logger.log(
          `⏭️ Skip AI auto-reply: Conversation ${conversation.id} is assigned to agent ${conversation.assignedAgentId}`,
        );
        return;
      }

      // ✋ ตรวจสอบว่าลูกค้าเคยขอคุยกับคนไปแล้วหรือไม่
      if (conversation.requestHuman) {
        this.logger.log(
          `⏭️ Skip AI auto-reply: Customer requested human for conversation ${conversation.id}`,
        );
        return;
      }

      this.logger.log(
        `🤖 Generating AI auto-reply for conversation: ${conversation.id}`,
      );

      // เรียก AI API เพื่อรับคำตอบ
      const aiResponse = await this.aiService.getAiResponse(
        customerMessage,
        conversation.id,
        customer.id,
      );

      // ส่งคำตอบกลับไปยัง platform (Facebook/Instagram/WhatsApp)
      let platformMessageId: string | undefined;
      if (platform.type === 'facebook') {
        platformMessageId = await this.sendFacebookMessage(
          platform,
          customer.externalId,
          aiResponse,
        );
      } else if (platform.type === 'instagram') {
        platformMessageId = await this.sendInstagramMessage(
          platform,
          customer.externalId,
          aiResponse,
        );
      } else if (platform.type === 'whatsapp') {
        platformMessageId = await this.sendWhatsAppMessage(
          platform,
          customer.externalId,
          aiResponse,
        );
      }

      // บันทึกข้อความ AI ลงในฐานข้อมูล
      const aiMessage = await this.prisma.message.create({
        data: {
          organizationId: platform.organizationId,
          conversationId: conversation.id,
          senderType: 'agent',
          content: aiResponse,
          contentType: 'text',
          platformMessageId,
        },
      });

      // อัปเดตเวลาข้อความล่าสุดของ conversation
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      });

      // ส่ง realtime notification ไปยัง dashboard
      this.realtime.emitNewMessage(
        platform.organizationId,
        conversation.id,
        aiMessage,
      );

      this.logger.log(`✅ AI auto-reply sent successfully`);
    } catch (error) {
      this.logger.error(`❌ Failed to send AI auto-reply: ${error.message}`);
    }
  }

  /**
   * ส่งข้อความผ่าน Facebook Messenger
   */
  async sendFacebookMessage(
    platform: any,
    recipientId: string,
    message: string,
    imageUrl?: string,
  ): Promise<string | undefined> {
    const pageToken = platform.accessToken;
    if (!pageToken) {
      throw new Error('Facebook access token not found');
    }

    let platformMessageId: string | undefined;

    // ถ้ามีรูปภาพ ส่ง text ก่อน แล้วส่งรูป
    if (imageUrl) {
      // ส่ง text message (ถ้ามี)
      if (message && message.trim()) {
        const textResponse = await axios.post(
          'https://graph.facebook.com/v21.0/me/messages',
          {
            messaging_type: 'RESPONSE',
            recipient: { id: recipientId },
            message: { text: message },
          },
          {
            params: { access_token: pageToken },
          },
        );
        platformMessageId =
          this.extractPlatformMessageId(textResponse.data) || platformMessageId;
      }

      // ส่ง image
      // เช็คว่า imageUrl เป็น data URL (base64) หรือ URL จริง
      if (imageUrl.startsWith('data:')) {
        // กรณี base64 data URL - ต้อง upload file
        console.log('🔸 Facebook image sending - base64 upload');
        const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        const form = new FormData();
        form.append('messaging_type', 'RESPONSE');
        form.append('recipient', JSON.stringify({ id: recipientId }));
        form.append(
          'message',
          JSON.stringify({
            attachment: {
              type: 'image',
              payload: {},
            },
          }),
        );
        form.append('filedata', buffer, {
          filename: 'image.png',
          contentType: 'image/png',
        });

        const mediaResponse = await axios.post(
          'https://graph.facebook.com/v21.0/me/messages',
          form,
          {
            params: { access_token: pageToken },
            headers: form.getHeaders(),
          },
        );
        platformMessageId =
          this.extractPlatformMessageId(mediaResponse.data) ||
          platformMessageId;
      } else if (imageUrl.startsWith('http')) {
        // กรณี URL จริง - ส่ง URL ให้ Facebook ดาวน์โหลดเอง
        console.log('🔸 Facebook image sending - URL:', imageUrl);
        const mediaResponse = await axios.post(
          'https://graph.facebook.com/v21.0/me/messages',
          {
            messaging_type: 'RESPONSE',
            recipient: { id: recipientId },
            message: {
              attachment: {
                type: 'image',
                payload: {
                  url: imageUrl,
                  is_reusable: true,
                },
              },
            },
          },
          {
            params: { access_token: pageToken },
          },
        );
        platformMessageId =
          this.extractPlatformMessageId(mediaResponse.data) ||
          platformMessageId;
      } else {
        console.warn('⚠️ Unsupported image URL format:', imageUrl);
      }
    } else {
      // ส่ง text อย่างเดียว
      const textResponse = await axios.post(
        'https://graph.facebook.com/v21.0/me/messages',
        {
          messaging_type: 'RESPONSE',
          recipient: { id: recipientId },
          message: { text: message },
        },
        {
          params: { access_token: pageToken },
        },
      );
      platformMessageId =
        this.extractPlatformMessageId(textResponse.data) || platformMessageId;
    }
    return platformMessageId;
  }

  /**
   * ส่งข้อความผ่าน Instagram Direct
   */
  async sendInstagramMessage(
    platform: any,
    recipientId: string,
    message: string,
    imageUrl?: string,
  ): Promise<string | undefined> {
    const pageToken = platform.accessToken;
    if (!pageToken) {
      throw new Error('Instagram access token not found');
    }

    let platformMessageId: string | undefined;

    // Instagram ใช้ API เดียวกับ Facebook
    if (imageUrl) {
      // ส่ง text message (ถ้ามี)
      if (message && message.trim()) {
        const textResponse = await axios.post(
          'https://graph.facebook.com/v21.0/me/messages',
          {
            messaging_type: 'RESPONSE',
            recipient: { id: recipientId },
            message: { text: message },
          },
          {
            params: { access_token: pageToken },
          },
        );
        platformMessageId =
          this.extractPlatformMessageId(textResponse.data) || platformMessageId;
      }

      // ส่ง image
      if (imageUrl.startsWith('data:')) {
        // กรณี base64 data URL
        console.log('🔸 Instagram image sending - base64 upload');
        const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        const form = new FormData();
        form.append('messaging_type', 'RESPONSE');
        form.append('recipient', JSON.stringify({ id: recipientId }));
        form.append(
          'message',
          JSON.stringify({
            attachment: {
              type: 'image',
              payload: {},
            },
          }),
        );
        form.append('filedata', buffer, {
          filename: 'image.png',
          contentType: 'image/png',
        });

        const mediaResponse = await axios.post(
          'https://graph.facebook.com/v21.0/me/messages',
          form,
          {
            params: { access_token: pageToken },
            headers: form.getHeaders(),
          },
        );
        platformMessageId =
          this.extractPlatformMessageId(mediaResponse.data) ||
          platformMessageId;
      } else if (imageUrl.startsWith('http')) {
        // กรณี URL จริง
        console.log('🔸 Instagram image sending - URL:', imageUrl);
        const mediaResponse = await axios.post(
          'https://graph.facebook.com/v21.0/me/messages',
          {
            messaging_type: 'RESPONSE',
            recipient: { id: recipientId },
            message: {
              attachment: {
                type: 'image',
                payload: {
                  url: imageUrl,
                  is_reusable: true,
                },
              },
            },
          },
          {
            params: { access_token: pageToken },
          },
        );
        platformMessageId =
          this.extractPlatformMessageId(mediaResponse.data) ||
          platformMessageId;
      } else {
        console.warn('⚠️ Unsupported image URL format:', imageUrl);
      }
    } else {
      const textResponse = await axios.post(
        'https://graph.facebook.com/v21.0/me/messages',
        {
          messaging_type: 'RESPONSE',
          recipient: { id: recipientId },
          message: { text: message },
        },
        {
          params: { access_token: pageToken },
        },
      );
      platformMessageId =
        this.extractPlatformMessageId(textResponse.data) || platformMessageId;
    }
    return platformMessageId;
  }

  /**
   * ส่งข้อความผ่าน WhatsApp Business API
   */
  async sendWhatsAppMessage(
    platform: any,
    recipientPhone: string,
    message: string,
    imageUrl?: string,
  ): Promise<string | undefined> {
    const phoneNumberId = platform.pageId;
    const accessToken = platform.accessToken;

    if (!phoneNumberId || !accessToken) {
      this.logger.error(
        `❌ WhatsApp credentials missing - phoneNumberId: ${phoneNumberId}, accessToken: ${accessToken ? 'present' : 'missing'}`,
      );
      throw new Error('WhatsApp credentials not found');
    }

    this.logger.debug(
      `📤 Sending WhatsApp message to ${recipientPhone} via Phone Number ID: ${phoneNumberId}`,
    );

    // ส่ง text message (ถ้ามี)
    let platformMessageId: string | undefined;
    if (message && message.trim()) {
      const textResponse = await axios.post(
        `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          to: recipientPhone,
          type: 'text',
          text: { body: message },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
      platformMessageId = this.extractPlatformMessageId(textResponse.data);
    }

    // ถ้ามีรูปภาพ ส่งต่อ
    if (imageUrl) {
      if (imageUrl.startsWith('http')) {
        // กรณี URL จริง - ส่ง URL ให้ WhatsApp ดาวน์โหลดเอง
        this.logger.log('🔸 WhatsApp image sending - URL:', imageUrl);
        const mediaResponse = await axios.post(
          `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
          {
            messaging_product: 'whatsapp',
            to: recipientPhone,
            type: 'image',
            image: {
              link: imageUrl,
            },
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          },
        );
        platformMessageId =
          this.extractPlatformMessageId(mediaResponse.data) ||
          platformMessageId;
      } else if (imageUrl.startsWith('data:')) {
        // กรณี base64 - ต้อง upload ก่อน (ยังไม่ implement)
        this.logger.log('🔸 WhatsApp base64 image upload not yet implemented');
      }
    }
    return platformMessageId;
  }

  /**
   * ส่ง Location ผ่าน WhatsApp Business API (native location message)
   */
  async sendWhatsAppLocation(
    platform: any,
    recipientPhone: string,
    latitude: number,
    longitude: number,
    name?: string,
    address?: string,
  ): Promise<string | undefined> {
    const phoneNumberId = platform.pageId;
    const accessToken = platform.accessToken;

    if (!phoneNumberId || !accessToken) {
      throw new Error('WhatsApp credentials not found');
    }

    this.logger.debug(`📍 Sending WhatsApp location to ${recipientPhone}`);

    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: recipientPhone,
        type: 'location',
        location: {
          latitude,
          longitude,
          ...(name && { name }),
          ...(address && { address }),
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      },
    );

    return this.extractPlatformMessageId(response.data);
  }
}




