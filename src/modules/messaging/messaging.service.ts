import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AiService } from '../ai/ai.service';
import axios from 'axios';

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly aiService: AiService,
  ) {}

  async processInbound(data: {
    platform: string;
    recipientId: string; // Page ID / IG Account ID / Phone Number ID
    externalCustomerId: string;
    messageId: string;
    content: string;
    contentType: string;
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
    
    // ค้นหา platforms ของ type นี้ทั้งหมด แล้ว filter ใน memory
    const platforms = await this.prisma.platform.findMany({
      where: { type: data.platform },
    });

    // หา platform ที่มี recipientId ตรงกับที่รับมา
    const platform = platforms.find((p) => {
      const creds = p.credentials as any;
      if (!creds) return false;

      // Facebook: เช็ค pageId
      if (data.platform === 'facebook' && creds.pageId === data.recipientId) {
        return true;
      }

      // Instagram: เช็ค instagramAccountId
      if (
        data.platform === 'instagram' &&
        creds.instagramAccountId === data.recipientId
      ) {
        return true;
      }

      // WhatsApp: เช็ค phoneNumberId
      if (
        data.platform === 'whatsapp' &&
        creds.phoneNumberId === data.recipientId
      ) {
        return true;
      }

      return false;
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
        `💬 Creating new conversation for customer: ${customer.id}`,
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

    this.logger.log(`📝 Creating message in conversation: ${conversation.id}`);
    const message = await this.prisma.message.create({
      data: {
        organizationId: platform.organizationId,
        conversationId: conversation.id,
        senderType: 'customer',
        platformMessageId: data.messageId,
        content: data.content,
        contentType: data.contentType,
        rawPayload: data.raw,
      },
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

    // 🤖 AI Auto-Reply: ตอบกลับอัตโนมัติด้วย AI
    await this.sendAiAutoReply(
      platform,
      conversation,
      customer,
      data.content,
    );
  }
  async getConversations(organizationId: string) {
    return this.prisma.conversation.findMany({
      where: { organizationId },
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
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async sendAgentMessage(
    organizationId: string,
    conversationId: string,
    content: string,
    agentId:any
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

    if (
      conversation.assignedAgentId &&
      conversation.assignedAgentId !== agentId
    ) {
      throw new Error('Conversation assigned to another agent');
    }

    // Get accessToken directly from platform (not from credentials JSON)
    const pageToken = conversation.platform.accessToken;
    if (!pageToken) {
      this.logger.error('❌ Platform accessToken missing');
      throw new Error('Platform credentials not configured');
    }

    const recipientId = conversation.customer.externalId;
    const platformType = conversation.platform.type;

    // 1️⃣ ส่งไปยัง Platform
    try {
      if (platformType === 'facebook') {
        await axios.post(
          'https://graph.facebook.com/v19.0/me/messages',
          {
            recipient: { id: recipientId },
            message: { text: content },
          },
          {
            params: { access_token: pageToken },
          },
        );
      } else if (platformType === 'instagram') {
        await axios.post(
          'https://graph.facebook.com/v19.0/me/messages',
          {
            recipient: { id: recipientId },
            message: { text: content },
          },
          {
            params: { access_token: pageToken },
          },
        );
      } else if (platformType === 'whatsapp') {
        const phoneNumberId = conversation.platform.pageId; // pageId stores phoneNumberId for WhatsApp
        await axios.post(
          `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
          {
            messaging_product: 'whatsapp',
            to: recipientId,
            type: 'text',
            text: { body: content },
          },
          {
            headers: {
              'Authorization': `Bearer ${pageToken}`,
              'Content-Type': 'application/json',
            },
          },
        );
      } else {
        throw new Error(`Platform ${platformType} not supported yet`);
      }
    } catch (err: any) {
      this.logger.error(`❌ ${platformType.toUpperCase()} Send Error`);
      this.logger.error(err.response?.data || err.message);
      throw err;
    }

    // 2️⃣ บันทึก message
    const message = await this.prisma.message.create({
      data: {
        organizationId,
        conversationId,
        senderType: 'agent',
        content,
      },
    });

    // 3️⃣ Realtime broadcast
    this.realtime.emitNewMessage(organizationId, conversationId, message);

    return message;
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
        `https://graph.facebook.com/v19.0/${pageId}/conversations`,
        {
          params: {
            access_token: pageAccessToken,
            fields: 'id,updated_time,participants',
          },
        },
      );

      const fbConversations = conversationsResponse.data.data || [];
      this.logger.log(`📋 Found ${fbConversations.length} Facebook conversations`);

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
              `https://graph.facebook.com/v19.0/${customer.id}`,
              {
                params: {
                  access_token: pageAccessToken,
                  fields: 'id,name,first_name,last_name,profile_pic',
                },
              },
            );

            if (profileResponse.data) {
              customerName = profileResponse.data.name || 
                             `${profileResponse.data.first_name || ''} ${profileResponse.data.last_name || ''}`.trim() ||
                             customer.id;
              
              this.logger.debug(`📝 Fetched profile: ${customerName}`);
            }
          } catch (error) {
            this.logger.debug(`⚠️ Could not fetch profile for ${customer.id}: ${error.message}`);
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
                status: 'open',
              },
            });
            syncedCount.conversations++;
          }

          // 5. ดึง messages จาก conversation (with pagination)
          let messagesUrl = `https://graph.facebook.com/v19.0/${fbConv.id}/messages`;
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
                } else if (typeof fbMsg.message === 'object' && fbMsg.message.text) {
                  messageContent = fbMsg.message.text;
                } else {
                  messageContent = JSON.stringify(fbMsg.message);
                }
                
                // ตัดข้อความถ้ายาวเกิน 60000 characters (ปลอดภัยสำหรับ TEXT)
                if (messageContent.length > 60000) {
                  messageContent = messageContent.substring(0, 60000) + '... (truncated)';
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
          this.logger.error(`❌ Error syncing conversation ${fbConv.id}:`, error.message);
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
      this.logger.error('❌ Facebook sync error:', error.response?.data || error.message);
      
      // ถ้าเป็น OAuth error (code 190) ให้ deactivate platform
      if (error.response?.data?.error?.code === 190) {
        this.logger.warn(`🔒 Deactivating platform ${platformId} due to invalid/expired token`);
        await this.prisma.platform.update({
          where: { id: platformId },
          data: { isActive: false },
        });
        throw new Error('Platform token expired. Please reconnect your Facebook page.');
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
    agentId: string,
    conversationId: string,
  ) {
    return this.prisma.conversation.update({
      where: {
        id: conversationId,
        organizationId: orgId,
      },
      data: {
        assignedAgentId: agentId,
        status: 'pending',
      },
    });
  }

  /**
   * ส่งคำตอบอัตโนมัติจาก AI เมื่อลูกค้าส่งข้อความเข้ามา
   */
  private async sendAiAutoReply(
    platform: any,
    conversation: any,
    customer: any,
    customerMessage: string,
  ) {
    try {
      this.logger.log(`🤖 Generating AI auto-reply for conversation: ${conversation.id}`);

      // เรียก AI API เพื่อรับคำตอบ
      const aiResponse = await this.aiService.getAiResponse(
        customerMessage,
        conversation.id,
        customer.id,
      );

      // ส่งคำตอบกลับไปยัง platform (Facebook/Instagram/WhatsApp)
      if (platform.type === 'facebook') {
        await this.sendFacebookMessage(platform, customer.externalId, aiResponse);
      } else if (platform.type === 'instagram') {
        await this.sendInstagramMessage(platform, customer.externalId, aiResponse);
      } else if (platform.type === 'whatsapp') {
        await this.sendWhatsAppMessage(platform, customer.externalId, aiResponse);
      }

      // บันทึกข้อความ AI ลงในฐานข้อมูล
      const aiMessage = await this.prisma.message.create({
        data: {
          organizationId: platform.organizationId,
          conversationId: conversation.id,
          senderType: 'agent',
          content: aiResponse,
          contentType: 'text',
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
  private async sendFacebookMessage(
    platform: any,
    recipientId: string,
    message: string,
  ) {
    const pageToken = platform.accessToken;
    if (!pageToken) {
      throw new Error('Facebook access token not found');
    }

    await axios.post(
      'https://graph.facebook.com/v19.0/me/messages',
      {
        recipient: { id: recipientId },
        message: { text: message },
      },
      {
        params: { access_token: pageToken },
      },
    );
  }

  /**
   * ส่งข้อความผ่าน Instagram Direct
   */
  private async sendInstagramMessage(
    platform: any,
    recipientId: string,
    message: string,
  ) {
    const pageToken = platform.accessToken;
    if (!pageToken) {
      throw new Error('Instagram access token not found');
    }

    await axios.post(
      'https://graph.facebook.com/v19.0/me/messages',
      {
        recipient: { id: recipientId },
        message: { text: message },
      },
      {
        params: { access_token: pageToken },
      },
    );
  }

  /**
   * ส่งข้อความผ่าน WhatsApp Business API
   */
  private async sendWhatsAppMessage(
    platform: any,
    recipientPhone: string,
    message: string,
  ) {
    const credentials = platform.credentials as any;
    const phoneNumberId = credentials?.phoneNumberId;
    const accessToken = platform.accessToken;

    if (!phoneNumberId || !accessToken) {
      throw new Error('WhatsApp credentials not found');
    }

    await axios.post(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
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
  }
}
