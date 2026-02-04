import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PluginsService } from './plugins.service';
import { PluginEngineService } from './plugin-engine.service';
import { QRCodeService } from './qrcode.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles, UserRole } from '../../common/decorators/roles.decorator';

@Controller('plugins')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class PluginsController {
  constructor(
    private pluginsService: PluginsService,
    private pluginEngine: PluginEngineService,
    private qrcodeService: QRCodeService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN)
  async findAll(@Req() req: any) {
    return this.pluginsService.findAll(req.user.organizationId);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  async findOne(@Req() req: any, @Param('id') id: string) {
    return this.pluginsService.findOne(id, req.user.organizationId);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  async create(
    @Req() req: any,
    @Body()
    body: {
      name: string;
      type: string;
      description?: string;
      apiKey?: string;
      apiSecret?: string;
      config?: any;
    }
  ) {
    return this.pluginsService.create(
      req.user.organizationId,
      req.user.id,
      body
    );
  }

  @Put(':id')
  @Roles(UserRole.ADMIN)
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      type?: string;
      description?: string;
      apiKey?: string;
      apiSecret?: string;
      config?: any;
      isActive?: boolean;
    }
  ) {
    return this.pluginsService.update(id, req.user.organizationId, body);
  }

  @Put(':id/toggle')
  @Roles(UserRole.ADMIN)
  async toggleActive(@Req() req: any, @Param('id') id: string) {
    return this.pluginsService.toggleActive(id, req.user.organizationId);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async delete(@Req() req: any, @Param('id') id: string) {
    return this.pluginsService.delete(id, req.user.organizationId);
  }

  /**
   * ดู default config ตัวอย่างสำหรับแต่ละ plugin type
   */
  @Get('templates/:type')
  @Roles(UserRole.ADMIN)
  async getTemplate(@Param('type') type: string) {
    switch (type) {
      case 'auto-reply':
        return {
          type: 'auto-reply',
          name: 'Auto-Reply Plugin',
          description: 'ตอบกลับอัตโนมัติตามคำสำคัญที่กำหนด',
          config: this.pluginEngine.getAutoReplyDefaultConfig(),
        };
      case 'business-hours':
        return {
          type: 'business-hours',
          name: 'Business Hours Plugin',
          description: 'ตรวจสอบเวลาทำการและแจ้งเตือนลูกค้า',
          config: this.pluginEngine.getBusinessHoursDefaultConfig(),
        };
      case 'welcome-message':
        return {
          type: 'welcome-message',
          name: 'Welcome Message Plugin',
          description: 'ส่งข้อความต้อนรับลูกค้าใหม่',
          config: this.pluginEngine.getWelcomeMessageDefaultConfig(),
        };
      case 'crm':
        return {
          type: 'crm',
          name: 'CRM Integration Plugin',
          description: 'เชื่อมต่อกับระบบ CRM (Salesforce, HubSpot)',
          config: {
            crmType: 'salesforce', // or 'hubspot', 'generic'
            autoCreateContact: true,
            apiKey: 'YOUR_CRM_API_KEY',
            apiSecret: 'YOUR_CRM_API_SECRET',
            syncFields: ['name', 'email', 'phone', 'company'],
          },
        };
      case 'analytics':
        return {
          type: 'analytics',
          name: 'Analytics Plugin',
          description: 'วิเคราะห์ข้อมูลและ sentiment ของข้อความ',
          config: {
            trackSentiment: true,
            trackKeywords: true,
            keywords: ['ราคา', 'product', 'จอง', 'ส่งของ', 'ชำระเงิน'],
            generateReports: true,
            reportInterval: 'daily', // daily, weekly, monthly
          },
        };
      case 'marketing':
        return {
          type: 'marketing',
          name: 'Marketing Automation Plugin',
          description: 'ส่งโปรโมชั่นและข้อความการตลาดอัตโนมัติ',
          config: {
            autoPromotion: true,
            promotionTriggers: [
              {
                keywords: ['ราคา', 'price', 'เท่าไหร่'],
                promotionMessage: '🎉 โปรโมชั่นพิเศษ! ลด 20% สำหรับลูกค้าใหม่\nใช้โค้ด: NEW20',
              },
              {
                keywords: ['จอง', 'booking', 'สั่งซื้อ'],
                promotionMessage: '💰 ฟรีค่าส่ง สำหรับยอดซื้อตั้งแต่ 500 บาทขึ้นไป!',
              },
            ],
          },
        };
      case 'support':
        return {
          type: 'support',
          name: 'Support Ticket Plugin',
          description: 'ระบบซัพพอร์ตและจัดการ ticket อัตโนมัติ',
          config: {
            autoCreateTicket: true,
            urgentKeywords: ['urgent', 'ด่วน', 'emergency', 'ฉุกเฉิน', 'help'],
            slaMinutes: 15, // Response time for urgent tickets
            assignTo: 'support-team',
            notifyEmail: 'support@example.com',
          },
        };
      case 'storage':
        return {
          type: 'storage',
          name: 'File Storage Plugin',
          description: 'จัดการและเก็บไฟล์ใน Cloud Storage',
          config: {
            storageType: 's3', // s3, google-drive, local
            autoBackup: true,
            maxFileSize: 10485760, // 10MB in bytes
            allowedFileTypes: ['image/jpeg', 'image/png', 'application/pdf'],
            s3Config: {
              bucket: 'my-bucket',
              region: 'ap-southeast-1',
              accessKeyId: 'YOUR_ACCESS_KEY',
              secretAccessKey: 'YOUR_SECRET_KEY',
            },
          },
        };
      case 'payment':
        return {
          type: 'payment',
          name: 'Payment Gateway Plugin',
          description: 'รับชำระเงินผ่าน Payment Gateway',
          config: {
            gateway: 'promptpay', // promptpay, stripe, omise
            paymentKeywords: ['จ่ายเงิน', 'ชำระเงิน', 'payment', 'pay'],
            promptpayConfig: {
              phoneNumber: '0812345678',
              generateQR: true,
            },
            stripeConfig: {
              publishableKey: 'pk_test_xxx',
              secretKey: 'sk_test_xxx',
            },
            omiseConfig: {
              publicKey: 'pkey_test_xxx',
              secretKey: 'skey_test_xxx',
            },
          },
        };
      default:
        return { error: 'Unknown plugin type' };
    }
  }

  @Get('qrcode/generate')
  async generateQRCode(
    @Query('phoneNumber') phoneNumber: string,
    @Query('amount') amount?: string,
  ) {
    if (!phoneNumber) {
      throw new Error('Phone number is required');
    }

    const amountNum = amount ? parseFloat(amount) : undefined;
    return this.qrcodeService.generatePromptPayQR(phoneNumber, amountNum);
  }
}
