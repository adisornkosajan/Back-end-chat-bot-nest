import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AiService } from '../ai/ai.service';
import { PluginEngineService } from '../plugins/plugin-engine.service';
import axios from 'axios';

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly aiService: AiService,
    private readonly pluginEngine: PluginEngineService,
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

    // 🔌 Plugin System: รัน plugins ที่เปิดใช้งาน
    const pluginResponded = await this.runPlugins(platform, conversation, customer, message);

    // 🤖 AI Auto-Reply: ตอบกลับอัตโนมัติด้วย AI (ถ้า Plugin ไม่ได้ตอบ)
    if (!pluginResponded) {
      await this.sendAiAutoReply(
        platform,
        conversation,
        customer,
        data.content,
      );
    } else {
      this.logger.log(`⏭️ Skipping AI auto-reply because plugin already responded`);
    }
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

    // Auto-assign conversation to agent if not assigned yet
    if (!conversation.assignedAgentId) {
      this.logger.log(`🎯 Auto-assigning conversation ${conversationId} to agent ${agentId}`);
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { 
          assignedAgentId: agentId,
          status: 'pending',
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
    agentId: string | null,
    conversationId: string,
  ) {
    this.logger.log(`📌 Assigning conversation ${conversationId} to agent: ${agentId || 'unassign'}`);

    // ถ้า agentId เป็น null แสดงว่าต้องการ unassign
    if (agentId === null) {
      return this.prisma.conversation.update({
        where: {
          id: conversationId,
          organizationId: orgId,
        },
        data: {
          assignedAgentId: null,
          status: 'open',
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
        status: 'pending',
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
      this.logger.log(`🔌 Running plugins for conversation: ${conversation.id}`);

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
          this.logger.log(`📤 Sending plugin response: ${response.message.substring(0, 50)}...`);

          // ส่งข้อความตามแต่ละ platform
          if (platform.type === 'facebook') {
            await this.sendFacebookMessage(platform, customer.externalId, response.message, response.imageUrl);
          } else if (platform.type === 'instagram') {
            await this.sendInstagramMessage(platform, customer.externalId, response.message, response.imageUrl);
          } else if (platform.type === 'whatsapp') {
            await this.sendWhatsAppMessage(platform, customer.externalId, response.message, response.imageUrl);
          }

          // บันทึกข้อความตอบกลับ
          const pluginMessage = await this.prisma.message.create({
            data: {
              organizationId: platform.organizationId,
              conversationId: conversation.id,
              senderType: 'agent',
              content: response.message,
              contentType: response.imageUrl ? 'image' : 'text',
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
        // ภาษาไทย
        'พูดกับคน', 'คุยกับคน', 'พูดกับพนักงาน', 'คุยกับพนักงาน',
        'พูดกับแอดมิน', 'คุยกับแอดมิน', 'ติดต่อพนักงาน', 'ติดต่อเจ้าหน้าที่',
        'ต้องการพูดกับคน', 'ขอพูดกับคน', 'ขอคุยกับคน',
        // English
        'talk to human', 'speak to human', 'talk to agent', 'speak to agent',
        'talk to staff', 'speak to staff', 'customer service', 'human agent',
        'real person', 'actual person', 'talk to admin', 'speak to admin',
        'contact staff', 'need human', 'want human', 'human support'
      ];

      const messageLC = customerMessage.toLowerCase();
      const isRequestingHuman = requestHumanKeywords.some(keyword => 
        messageLC.includes(keyword.toLowerCase())
      );

      if (isRequestingHuman) {
        this.logger.log(`🙋 Customer requesting human agent for conversation: ${conversation.id}`);
        
        // อัปเดต conversation flag (แม้จะมี agent assign อยู่แล้วก็อัปเดตได้)
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { requestHuman: true },
        });

        // ตอบกลับว่ากำลังเชื่อมต่อกับเจ้าหน้าที่
        const humanRequestResponse = messageLC.includes('พ') || messageLC.includes('คุย') 
          ? 'ขอสักครู่นะคะ กำลังเชื่อมต่อกับเจ้าหน้าที่ให้คุณค่ะ 🙏'
          : 'Please wait a moment. We\'re connecting you to our staff. 🙏';

        // ส่งข้อความตอบกลับ
        if (platform.type === 'facebook') {
          await this.sendFacebookMessage(platform, customer.externalId, humanRequestResponse);
        } else if (platform.type === 'instagram') {
          await this.sendInstagramMessage(platform, customer.externalId, humanRequestResponse);
        } else if (platform.type === 'whatsapp') {
          await this.sendWhatsAppMessage(platform, customer.externalId, humanRequestResponse);
        }

        // บันทึกข้อความตอบกลับ
        const aiMessage = await this.prisma.message.create({
          data: {
            organizationId: platform.organizationId,
            conversationId: conversation.id,
            senderType: 'agent',
            content: humanRequestResponse,
            contentType: 'text',
          },
        });

        // ส่ง realtime notification
        this.realtime.emitNewMessage(
          platform.organizationId,
          conversation.id,
          aiMessage,
        );

        this.logger.log(`✅ Human request acknowledged and conversation flagged`);
        return; // หยุดไม่ตอบต่อ
      }

      // ✋ ตรวจสอบว่ามี agent assign หรือไม่
      if (conversation.assignedAgentId) {
        this.logger.log(`⏭️ Skip AI auto-reply: Conversation ${conversation.id} is assigned to agent ${conversation.assignedAgentId}`);
        return;
      }

      // ✋ ตรวจสอบว่าลูกค้าเคยขอคุยกับคนไปแล้วหรือไม่
      if (conversation.requestHuman) {
        this.logger.log(`⏭️ Skip AI auto-reply: Customer requested human for conversation ${conversation.id}`);
        return;
      }

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
    imageUrl?: string,
  ) {
    const pageToken = platform.accessToken;
    if (!pageToken) {
      throw new Error('Facebook access token not found');
    }

    // ถ้ามีรูปภาพ ส่ง text ก่อน แล้วส่งรูป
    if (imageUrl) {
      // ส่ง text message
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

      // ส่ง image (ถ้าเป็น data URL ต้องแปลงเป็น hosted URL)
      // Facebook ต้องการ URL จริง ไม่รับ data:image/png;base64
      // เราจะ upload ไปเป็น attachment แทน
      const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      
      // Upload เป็น attachment
      const FormData = require('form-data');
      const form = new FormData();
      form.append('recipient', JSON.stringify({ id: recipientId }));
      form.append('message', JSON.stringify({
        attachment: {
          type: 'image',
          payload: {},
        },
      }));
      form.append('filedata', buffer, {
        filename: 'qrcode.png',
        contentType: 'image/png',
      });

      await axios.post(
        'https://graph.facebook.com/v19.0/me/messages',
        form,
        {
          params: { access_token: pageToken },
          headers: form.getHeaders(),
        },
      );
    } else {
      // ส่ง text อย่างเดียว
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
  }

  /**
   * ส่งข้อความผ่าน Instagram Direct
   */
  private async sendInstagramMessage(
    platform: any,
    recipientId: string,
    message: string,
    imageUrl?: string,
  ) {
    const pageToken = platform.accessToken;
    if (!pageToken) {
      throw new Error('Instagram access token not found');
    }

    // Instagram ใช้ API เดียวกับ Facebook
    if (imageUrl) {
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

      const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      
      const FormData = require('form-data');
      const form = new FormData();
      form.append('recipient', JSON.stringify({ id: recipientId }));
      form.append('message', JSON.stringify({
        attachment: {
          type: 'image',
          payload: {},
        },
      }));
      form.append('filedata', buffer, {
        filename: 'qrcode.png',
        contentType: 'image/png',
      });

      await axios.post(
        'https://graph.facebook.com/v19.0/me/messages',
        form,
        {
          params: { access_token: pageToken },
          headers: form.getHeaders(),
        },
      );
    } else {
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
  }

  /**
   * ส่งข้อความผ่าน WhatsApp Business API
   */
  private async sendWhatsAppMessage(
    platform: any,
    recipientPhone: string,
    message: string,
    imageUrl?: string,
  ) {
    const phoneNumberId = platform.pageId;
    const accessToken = platform.accessToken;

    if (!phoneNumberId || !accessToken) {
      this.logger.error(`❌ WhatsApp credentials missing - phoneNumberId: ${phoneNumberId}, accessToken: ${accessToken ? 'present' : 'missing'}`);
      throw new Error('WhatsApp credentials not found');
    }

    this.logger.debug(`📤 Sending WhatsApp message to ${recipientPhone} via Phone Number ID: ${phoneNumberId}`);

    // ส่ง text message
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

    // ถ้ามีรูปภาพ ส่งต่อ
    if (imageUrl) {
      // WhatsApp ต้อง upload image ก่อน แล้วส่ง media_id
      // หรือส่ง link URL โดยตรง (ถ้า host รูปบน server)
      // สำหรับ demo จะส่งแค่ text ก่อน (ต้อง implement image upload)
      this.logger.log('🔸 WhatsApp image sending requires media upload - currently sending text only');
    }
  }
}
