import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QRCodeService } from './qrcode.service';

export interface PluginContext {
  message: {
    content: string;
    senderId: string;
    conversationId: string;
    platform: string;
  };
  conversation: {
    id: string;
    isFirstMessage: boolean;
    messageCount: number;
  };
  organizationId: string;
}

export interface PluginResponse {
  shouldRespond: boolean;
  message?: string;
  imageUrl?: string; // สำหรับส่งรูปภาพ (QR Code)
  stopProcessing?: boolean; // หยุดการทำงานของ plugins อื่น
}

export interface PluginConfig {
  [key: string]: any;
}

@Injectable()
export class PluginEngineService {
  private readonly logger = new Logger(PluginEngineService.name);

  constructor(
    private prisma: PrismaService,
    private qrcodeService: QRCodeService,
  ) {}

  /**
   * รัน plugins ทั้งหมดที่เปิดใช้งาน
   */
  async executePlugins(context: PluginContext): Promise<PluginResponse[]> {
    try {
      // ดึง plugins ที่เปิดใช้งาน
      const activePlugins = await this.prisma.plugin.findMany({
        where: {
          organizationId: context.organizationId,
          isActive: true,
        },
        orderBy: {
          createdAt: 'asc', // รันตามลำดับที่สร้าง
        },
      });

      const responses: PluginResponse[] = [];

      for (const plugin of activePlugins) {
        try {
          let response: PluginResponse | null = null;

          // เรียกใช้ plugin แต่ละตัว
          switch (plugin.type) {
            case 'auto-reply':
              response = await this.runAutoReplyPlugin(plugin.config as PluginConfig, context);
              break;
            case 'business-hours':
              response = await this.runBusinessHoursPlugin(plugin.config as PluginConfig, context);
              break;
            case 'welcome-message':
              response = await this.runWelcomeMessagePlugin(plugin.config as PluginConfig, context);
              break;
            case 'crm':
              response = await this.runCRMPlugin(plugin.config as PluginConfig, context);
              break;
            case 'analytics':
              response = await this.runAnalyticsPlugin(plugin.config as PluginConfig, context);
              break;
            case 'marketing':
              response = await this.runMarketingPlugin(plugin.config as PluginConfig, context);
              break;
            case 'support':
              response = await this.runSupportPlugin(plugin.config as PluginConfig, context);
              break;
            case 'storage':
              response = await this.runStoragePlugin(plugin.config as PluginConfig, context);
              break;
            case 'payment':
              response = await this.runPaymentPlugin(plugin.config as PluginConfig, context);
              break;
            default:
              this.logger.warn(`Unknown plugin type: ${plugin.type}`);
          }

          if (response) {
            responses.push(response);
            
            // หยุดถ้า plugin บอกให้หยุด
            if (response.stopProcessing) {
              break;
            }
          }
        } catch (error) {
          this.logger.error(`Error executing plugin ${plugin.name}:`, error);
        }
      }

      return responses;
    } catch (error) {
      this.logger.error('Error executing plugins:', error);
      return [];
    }
  }

  /**
   * Plugin 1: Auto-Reply - ตอบกลับอัตโนมัติตามคำสำคัญ
   */
  private async runAutoReplyPlugin(
    config: PluginConfig,
    context: PluginContext,
  ): Promise<PluginResponse | null> {
    const rules = config?.rules || [];
    const message = context.message.content.toLowerCase();

    for (const rule of rules) {
      const keywords = rule.keywords || [];
      const matchAny = rule.matchAny !== false; // default true

      if (matchAny) {
        // ตรงคำไหนก็ได้
        if (keywords.some((keyword: string) => message.includes(keyword.toLowerCase()))) {
          return {
            shouldRespond: true,
            message: rule.response,
            stopProcessing: rule.stopAfterMatch || false,
          };
        }
      } else {
        // ต้องตรงทุกคำ
        if (keywords.every((keyword: string) => message.includes(keyword.toLowerCase()))) {
          return {
            shouldRespond: true,
            message: rule.response,
            stopProcessing: rule.stopAfterMatch || false,
          };
        }
      }
    }

    return null;
  }

  /**
   * Plugin 2: Business Hours - ตรวจสอบเวลาทำการ
   */
  private async runBusinessHoursPlugin(
    config: PluginConfig,
    context: PluginContext,
  ): Promise<PluginResponse | null> {
    const timezone = config?.timezone || 'Asia/Bangkok';
    const schedule = config?.schedule || {
      monday: { open: '09:00', close: '18:00' },
      tuesday: { open: '09:00', close: '18:00' },
      wednesday: { open: '09:00', close: '18:00' },
      thursday: { open: '09:00', close: '18:00' },
      friday: { open: '09:00', close: '18:00' },
      saturday: { open: '09:00', close: '15:00' },
      sunday: { closed: true },
    };

    const now = new Date();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const currentDay = dayNames[now.getDay()];
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    const daySchedule = schedule[currentDay];

    // ถ้าวันนี้ปิด
    if (daySchedule?.closed) {
      return {
        shouldRespond: true,
        message: config?.closedMessage || '🔒 ขณะนี้เราปิดทำการค่ะ\nเปิดทำการวันจันทร์-เสาร์ 09:00-18:00 น.\nฝากข้อความไว้ได้เลยค่ะ เราจะตอบกลับโดยเร็วที่สุด 😊',
        stopProcessing: false,
      };
    }

    // ตรวจสอบเวลาทำการ
    if (daySchedule?.open && daySchedule?.close) {
      if (currentTime < daySchedule.open || currentTime > daySchedule.close) {
        return {
          shouldRespond: true,
          message: config?.outsideHoursMessage || `⏰ ขณะนี้นอกเวลาทำการค่ะ\nเปิดทำการ ${daySchedule.open}-${daySchedule.close} น.\nฝากข้อความไว้ได้เลยค่ะ เราจะตอบกลับโดยเร็วที่สุด 😊`,
          stopProcessing: false,
        };
      }
    }

    return null;
  }

  /**
   * Plugin 3: Welcome Message - ทักทายลูกค้าใหม่
   */
  private async runWelcomeMessagePlugin(
    config: PluginConfig,
    context: PluginContext,
  ): Promise<PluginResponse | null> {
    // ส่งข้อความต้อนรับเฉพาะข้อความแรก
    if (!context.conversation.isFirstMessage) {
      return null;
    }

    const welcomeMessage = config?.message || `👋 สวัสดีค่ะ! ยินดีต้อนรับค่ะ\n\nเรายินดีให้บริการคุณ มีอะไรให้ช่วยไหมคะ? 😊`;

    return {
      shouldRespond: true,
      message: welcomeMessage,
      stopProcessing: false,
    };
  }

  /**
   * Plugin 4: CRM - เชื่อมต่อกับ CRM systems
   */
  private async runCRMPlugin(
    config: PluginConfig,
    context: PluginContext,
  ): Promise<PluginResponse | null> {
    const crmType = config?.crmType || 'generic'; // salesforce, hubspot, generic
    const autoCreateContact = config?.autoCreateContact !== false;

    // สำหรับการพัฒนาต่อ: เชื่อมต่อ API ของ CRM จริง
    this.logger.log(`CRM Plugin: Syncing contact for conversation ${context.conversation.id} to ${crmType}`);

    // ตัวอย่าง: บันทึกข้อมูลลูกค้า
    if (autoCreateContact && context.conversation.isFirstMessage) {
      // TODO: Call CRM API to create/update contact
      this.logger.log(`Creating contact in ${crmType} CRM`);
    }

    return null; // CRM ไม่ส่งข้อความตอบกลับ
  }

  /**
   * Plugin 5: Analytics - วิเคราะห์ข้อมูล
   */
  private async runAnalyticsPlugin(
    config: PluginConfig,
    context: PluginContext,
  ): Promise<PluginResponse | null> {
    const trackSentiment = config?.trackSentiment !== false;
    const trackKeywords = config?.trackKeywords !== false;

    this.logger.log(`Analytics Plugin: Analyzing message for conversation ${context.conversation.id}`);

    // Sentiment Analysis (ง่ายๆ)
    if (trackSentiment) {
      const message = context.message.content.toLowerCase();
      const positiveWords = ['ดี', 'สวย', 'ชอบ', 'เยี่ยม', 'perfect', 'good', 'great', 'love'];
      const negativeWords = ['แย่', 'ไม่ดี', 'เสีย', 'bad', 'poor', 'hate', 'terrible'];

      const sentiment = positiveWords.some(w => message.includes(w)) 
        ? 'positive' 
        : negativeWords.some(w => message.includes(w)) 
        ? 'negative' 
        : 'neutral';

      this.logger.log(`Sentiment: ${sentiment}`);
      // TODO: บันทึก sentiment ลงฐานข้อมูล
    }

    // Keyword Tracking
    if (trackKeywords && config?.keywords) {
      const message = context.message.content.toLowerCase();
      const foundKeywords = config.keywords.filter((kw: string) => 
        message.includes(kw.toLowerCase())
      );
      
      if (foundKeywords.length > 0) {
        this.logger.log(`Found keywords: ${foundKeywords.join(', ')}`);
        // TODO: บันทึก keyword stats
      }
    }

    return null; // Analytics ไม่ส่งข้อความตอบกลับ
  }

  /**
   * Plugin 6: Marketing - ส่งโปรโมชั่นและข้อความการตลาด
   */
  private async runMarketingPlugin(
    config: PluginConfig,
    context: PluginContext,
  ): Promise<PluginResponse | null> {
    const autoPromotion = config?.autoPromotion !== false;
    const promotionTriggers = config?.promotionTriggers || [];

    // ตรวจสอบว่าควรส่งโปรโมชั่นไหม
    if (autoPromotion && promotionTriggers.length > 0) {
      const message = context.message.content.toLowerCase();

      for (const trigger of promotionTriggers) {
        const keywords = trigger.keywords || [];
        if (keywords.some((kw: string) => message.includes(kw.toLowerCase()))) {
          return {
            shouldRespond: true,
            message: trigger.promotionMessage || '🎉 เรามีโปรโมชั่นพิเศษสำหรับคุณ!',
            stopProcessing: false,
          };
        }
      }
    }

    return null;
  }

  /**
   * Plugin 7: Support - ระบบซัพพอร์ต
   */
  private async runSupportPlugin(
    config: PluginConfig,
    context: PluginContext,
  ): Promise<PluginResponse | null> {
    const autoCreateTicket = config?.autoCreateTicket !== false;
    const urgentKeywords = config?.urgentKeywords || ['urgent', 'ด่วน', 'emergency', 'ฉุกเฉิน'];
    
    const message = context.message.content.toLowerCase();
    const isUrgent = urgentKeywords.some((kw: string) => message.includes(kw.toLowerCase()));

    if (isUrgent) {
      this.logger.warn(`🚨 Urgent support needed for conversation ${context.conversation.id}`);
      
      // TODO: สร้าง ticket ในระบบ
      // TODO: แจ้งเตือนทีม support
      
      return {
        shouldRespond: true,
        message: '🚨 เราได้รับเรื่องด่วนของคุณแล้วค่ะ\nทีมงานจะติดต่อกลับโดยเร็วที่สุด ภายใน 15 นาที',
        stopProcessing: false,
      };
    }

    // สำหรับเรื่องทั่วไป
    if (autoCreateTicket && context.conversation.messageCount > 5) {
      // TODO: สร้าง support ticket
      this.logger.log(`Creating support ticket for conversation ${context.conversation.id}`);
    }

    return null;
  }

  /**
   * Plugin 8: Storage - จัดการไฟล์
   */
  private async runStoragePlugin(
    config: PluginConfig,
    context: PluginContext,
  ): Promise<PluginResponse | null> {
    const storageType = config?.storageType || 'local'; // local, s3, google-drive
    const autoBackup = config?.autoBackup !== false;

    // TODO: ตรวจสอบว่ามีไฟล์ถูกส่งมาไหม
    // TODO: อัพโหลดไปยัง storage ที่กำหนด
    
    this.logger.log(`Storage Plugin: Type = ${storageType}, Auto-backup = ${autoBackup}`);

    return null; // Storage ไม่ส่งข้อความตอบกลับ
  }

  /**
   * ดึงจำนวนเงินจากข้อความ
   * รองรับรูปแบบ: "ชำระเงิน 500", "จ่าย 1000 บาท", "payment 250"
   */
  private extractAmountFromMessage(message: string): number | undefined {
    // รูปแบบที่รองรับ: ตัวเลข 1-6 หลัก ตามด้วย "บาท" หรือไม่ก็ได้
    const patterns = [
      /(\d{1,6})\s*บาท/i,           // "500 บาท", "1000บาท"
      /(\d{1,6})\s*baht/i,           // "500 baht"
      /(\d{1,6})\s*฿/,               // "500฿"
      /(?:ชำระ|จ่าย|pay|payment)\s+(\d{1,6})/i, // "ชำระ 500", "pay 1000"
      /(\d{1,6})\s*$/, // ตัวเลขท้ายข้อความ
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        const amount = parseFloat(match[1]);
        // ตรวจสอบว่าเป็นจำนวนเงินที่สมเหตุสมผล (1-1,000,000 บาท)
        if (amount >= 1 && amount <= 1000000) {
          return amount;
        }
      }
    }

    return undefined;
  }

  /**
   * Plugin 9: Payment - ระบบชำระเงิน
   */
  private async runPaymentPlugin(
    config: PluginConfig,
    context: PluginContext,
  ): Promise<PluginResponse | null> {
    const paymentGateway = config?.gateway || 'promptpay';
    const paymentKeywords = config?.paymentKeywords || ['จ่ายเงิน', 'ชำระเงิน', 'payment', 'pay'];
    
    const message = context.message.content.toLowerCase();
    const wantsToPayment = paymentKeywords.some((kw: string) => message.includes(kw.toLowerCase()));

    if (wantsToPayment) {
      if (paymentGateway === 'promptpay') {
        // สร้าง QR Code
        const phoneNumber = config?.promptpayConfig?.phoneNumber || '0812345678';
        
        // ลองดึงจำนวนเงินจากข้อความก่อน ถ้าไม่มีใช้ default
        let amount = this.extractAmountFromMessage(context.message.content);
        if (!amount) {
          amount = config?.promptpayConfig?.defaultAmount;
        }
        
        try {
          const qrData = await this.qrcodeService.generatePromptPayQR(phoneNumber, amount);
          
          // สร้างข้อความตอบกลับ
          let responseMessage = `💳 ช่องทางการชำระเงิน\n\n📱 พร้อมเพย์: ${phoneNumber}`;
          
          if (amount) {
            responseMessage += `\n💰 จำนวนเงิน: ${amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`;
          }
          
          responseMessage += '\n\n📲 สแกน QR Code ด้านล่างเพื่อชำระเงิน';
          
          return {
            shouldRespond: true,
            message: responseMessage,
            imageUrl: qrData.qrCodeImage, // ส่ง QR Code image
            stopProcessing: false,
          };
        } catch (error) {
          this.logger.error('Failed to generate QR Code', error);
          return {
            shouldRespond: true,
            message: `💳 ช่องทางการชำระเงิน\n\n📱 พร้อมเพย์: ${phoneNumber}\n💰 สแกน QR Code เพื่อชำระเงิน`,
            stopProcessing: false,
          };
        }
      } else if (paymentGateway === 'stripe' || paymentGateway === 'omise') {
        return {
          shouldRespond: true,
          message: '💳 คลิกลิงก์เพื่อชำระเงินผ่านบัตรเครดิต\n🔗 [Payment Link]',
          stopProcessing: false,
        };
      }
    }

    return null;
  }

  /**
   * ตั้งค่า config สำหรับ Auto-Reply Plugin
   */
  getAutoReplyDefaultConfig(): PluginConfig {
    return {
      rules: [
        {
          keywords: ['ราคา', 'เท่าไหร่', 'ค่าบริการ'],
          matchAny: true,
          response: '💰 ราคาบริการของเรามีดังนี้ค่ะ:\n\n• บริการ A - 500 บาท\n• บริการ B - 800 บาท\n• บริการ C - 1,200 บาท\n\nสนใจบริการไหนคะ?',
          stopAfterMatch: false,
        },
        {
          keywords: ['จองคิว', 'นัดหมาย', 'booking'],
          matchAny: true,
          response: '📅 สำหรับการจองคิว กรุณาแจ้ง:\n1. วันที่ต้องการ\n2. เวลาที่สะดวก\n3. บริการที่สนใจ\n\nเราจะจัดการให้นะคะ 😊',
          stopAfterMatch: true,
        },
        {
          keywords: ['ที่อยู่', 'อยู่ไหน', 'location'],
          matchAny: true,
          response: '📍 ที่อยู่: 123 ถนนสุขุมวิท กรุงเทพฯ 10110\n📞 โทร: 02-xxx-xxxx\n🕐 เปิดทำการ: จันทร์-เสาร์ 09:00-18:00 น.',
          stopAfterMatch: false,
        },
      ],
    };
  }

  /**
   * ตั้งค่า config สำหรับ Business Hours Plugin
   */
  getBusinessHoursDefaultConfig(): PluginConfig {
    return {
      timezone: 'Asia/Bangkok',
      schedule: {
        monday: { open: '09:00', close: '18:00' },
        tuesday: { open: '09:00', close: '18:00' },
        wednesday: { open: '09:00', close: '18:00' },
        thursday: { open: '09:00', close: '18:00' },
        friday: { open: '09:00', close: '18:00' },
        saturday: { open: '09:00', close: '15:00' },
        sunday: { closed: true },
      },
      closedMessage: '🔒 ขณะนี้เราปิดทำการค่ะ\nเปิดทำการวันจันทร์-เสาร์ 09:00-18:00 น.\nฝากข้อความไว้ได้เลยค่ะ เราจะตอบกลับโดยเร็วที่สุด 😊',
      outsideHoursMessage: '⏰ ขณะนี้นอกเวลาทำการค่ะ\nฝากข้อความไว้ได้เลยค่ะ เราจะตอบกลับเมื่อเปิดทำการ 😊',
    };
  }

  /**
   * ตั้งค่า config สำหรับ Welcome Message Plugin
   */
  getWelcomeMessageDefaultConfig(): PluginConfig {
    return {
      message: '👋 สวัสดีค่ะ! ยินดีต้อนรับค่ะ\n\nเรายินดีให้บริการคุณ มีอะไรให้ช่วยไหมคะ? 😊',
    };
  }
}
