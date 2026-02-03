import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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
  stopProcessing?: boolean; // หยุดการทำงานของ plugins อื่น
}

export interface PluginConfig {
  [key: string]: any;
}

@Injectable()
export class PluginEngineService {
  private readonly logger = new Logger(PluginEngineService.name);

  constructor(private prisma: PrismaService) {}

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
