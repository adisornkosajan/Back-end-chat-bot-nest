import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import axios from 'axios';

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  // ==================== FACEBOOK ====================
  async getFacebookPages(organizationId: string) {
    this.logger.debug(`Getting Facebook pages for org: ${organizationId}`);

    // หา Facebook platforms ที่มี access token
    const fbPlatforms = await this.prisma.platform.findMany({
      where: {
        organizationId,
        type: 'facebook',
        isActive: true,
      },
    });

    if (fbPlatforms.length === 0) {
      this.logger.warn('No Facebook platforms found');
      return [];
    }

    // ใช้ token แรกในการดึง pages
    const accessToken = fbPlatforms[0].accessToken;

    try {
      const response = await axios.get(
        'https://graph.facebook.com/v21.0/me/accounts',
        {
          params: {
            access_token: accessToken,
            fields: 'id,name,category,access_token,instagram_business_account{id,username,name,profile_picture_url}',
          },
        },
      );

      const pages = response.data.data || [];

      // เพิ่มข้อมูลว่า page ไหนเชื่อมต่อแล้ว
      const pagesWithStatus = pages.map((page: any) => {
        const connectedPlatform = fbPlatforms.find(
          (p) => p.pageId === page.id,
        );
        return {
          id: page.id,
          name: page.name,
          category: page.category,
          connected: !!connectedPlatform,
          platformId: connectedPlatform?.id,
          hasInstagram: !!page.instagram_business_account,
          instagramId: page.instagram_business_account?.id,
        };
      });

      return pagesWithStatus;
    } catch (error) {
      this.logger.error('Failed to fetch Facebook pages:', error.response?.data || error.message);
      throw new BadRequestException('Failed to fetch Facebook pages');
    }
  }

  async connectFacebookPage(organizationId: string, pageId: string) {
    this.logger.log(`🔌 Connecting Facebook page: ${pageId} to org: ${organizationId}`);

    // 🔒 CRITICAL: Validate organization exists
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      this.logger.error(`❌ Invalid organizationId: ${organizationId}`);
      throw new NotFoundException('Organization not found');
    }

    // หา access token จาก platforms ที่มีอยู่
    const fbPlatforms = await this.prisma.platform.findMany({
      where: {
        organizationId,
        type: 'facebook',
      },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });

    if (fbPlatforms.length === 0) {
      this.logger.warn(`⚠️ No Facebook account connected for org: ${organizationId}`);
      throw new NotFoundException('No Facebook account connected. Please authenticate first.');
    }

    const userAccessToken = fbPlatforms[0].accessToken;

    // ดึงข้อมูล page และ page access token
    try {
      const response = await axios.get(
        `https://graph.facebook.com/v21.0/me/accounts`,
        {
          params: {
            access_token: userAccessToken,
            fields: 'id,name,access_token,instagram_business_account{id,username}',
          },
        },
      );

      const page = response.data.data.find((p: any) => p.id === pageId);

      if (!page) {
        throw new NotFoundException('Page not found');
      }

      // 🔒 CRITICAL: ตรวจสอบว่า Page ID นี้ถูกใช้โดย organization อื่นแล้วหรือยัง
      const existingPlatform = await this.prisma.platform.findFirst({
        where: {
          type: 'facebook',
          pageId,
          organizationId: { not: organizationId },
          isActive: true,
        },
        include: {
          organization: {
            select: {
              name: true,
            },
          },
        },
      });

      if (existingPlatform) {
        this.logger.error(`❌ Page ID ${pageId} is already connected to organization: ${existingPlatform.organization.name}`);
        throw new BadRequestException(
          `This Facebook Page is already connected to another organization (${existingPlatform.organization.name}). ` +
          `Each page can only be connected to one organization at a time. ` +
          `Please disconnect it from the other organization first.`
        );
      }

      // Save/Update platform with page details
      const platform = await this.prisma.platform.upsert({
        where: {
          organizationId_type_pageId: {
            organizationId,
            type: 'facebook',
            pageId,
          },
        },
        update: {
          accessToken: page.access_token,
          isActive: true,
          credentials: {
            pageName: page.name,
            pageId: page.id,
          },
        },
        create: {
          organizationId,
          type: 'facebook',
          pageId,
          accessToken: page.access_token,
          isActive: true,
          credentials: {
            pageName: page.name,
            pageId: page.id,
          },
        },
      });

      // ถ้ามี Instagram business account เชื่อมด้วย
      if (page.instagram_business_account) {
        await this.connectInstagramAccount(
          organizationId,
          page.instagram_business_account.id,
          page.access_token,
          {
            id: page.instagram_business_account.id,
            username: page.instagram_business_account.username,
          },
        );
      }

      return {
        success: true,
        platform,
      };
    } catch (error) {
      this.logger.error('Failed to connect Facebook page:', error.response?.data || error.message);
      throw new BadRequestException('Failed to connect Facebook page');
    }
  }

  async disconnectFacebookPage(organizationId: string, pageId: string) {
    this.logger.log(`Disconnecting Facebook page: ${pageId}`);

    const platform = await this.prisma.platform.findFirst({
      where: {
        organizationId,
        type: 'facebook',
        pageId,
      },
    });

    if (!platform) {
      throw new NotFoundException('Platform not found');
    }

    await this.prisma.platform.update({
      where: { id: platform.id },
      data: { isActive: false },
    });

    return {
      success: true,
      message: 'Facebook page disconnected',
    };
  }

  // ==================== INSTAGRAM ====================
  async getInstagramAccounts(organizationId: string) {
    this.logger.debug(`Getting Instagram accounts for org: ${organizationId}`);

    const igPlatforms = await this.prisma.platform.findMany({
      where: {
        organizationId,
        type: 'instagram',
      },
      select: {
        id: true,
        pageId: true,
        isActive: true,
        createdAt: true,
      },
    });

    // ดึงข้อมูล Instagram accounts จาก Graph API
    const fbPlatforms = await this.prisma.platform.findMany({
      where: {
        organizationId,
        type: 'facebook',
        isActive: true,
      },
      take: 1,
    });

    if (fbPlatforms.length === 0) {
      return [];
    }

    try {
      const response = await axios.get(
        'https://graph.facebook.com/v21.0/me/accounts',
        {
          params: {
            access_token: fbPlatforms[0].accessToken,
            fields: 'instagram_business_account{id,username,name,profile_picture_url,followers_count}',
          },
        },
      );

      const accounts: any[] = [];
      response.data.data.forEach((page: any) => {
        if (page.instagram_business_account) {
          const ig = page.instagram_business_account;
          const connectedPlatform = igPlatforms.find(
            (p) => p.pageId === ig.id,
          );
          accounts.push({
            id: ig.id,
            username: ig.username,
            name: ig.name,
            profilePicture: ig.profile_picture_url,
            connected: connectedPlatform?.isActive || false,
            platformId: connectedPlatform?.id,
          });
        }
      });

      return accounts;
    } catch (error) {
      this.logger.error('Failed to fetch Instagram accounts:', error.response?.data || error.message);
      return [];
    }
  }

  async connectInstagramAccount(
    organizationId: string,
    accountId: string,
    accessToken?: string,
    accountData?: any,
  ) {
    this.logger.log(`🔌 Connecting Instagram account: ${accountId} to org: ${organizationId}`);

    // 🔒 CRITICAL: Validate organization exists
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      this.logger.error(`❌ Invalid organizationId: ${organizationId}`);
      throw new NotFoundException('Organization not found');
    }

    // ถ้าไม่มี token ให้หาจาก Facebook platform
    if (!accessToken) {
      const fbPlatforms = await this.prisma.platform.findMany({
        where: {
          organizationId,
          type: 'facebook',
          isActive: true,
        },
        take: 1,
      });

      if (fbPlatforms.length === 0) {
        throw new NotFoundException('No Facebook account connected');
      }

      accessToken = fbPlatforms[0].accessToken;
    }

    // ดึงข้อมูล Instagram account ถ้ายังไม่มี
    let igInfo = accountData;
    if (!igInfo && accessToken) {
      try {
        const response = await axios.get(
          `https://graph.facebook.com/v21.0/${accountId}`,
          {
            params: {
              access_token: accessToken,
              fields: 'id,username,name,profile_picture_url',
            },
          },
        );
        igInfo = response.data;
      } catch (error) {
        this.logger.warn('Could not fetch Instagram account info');
      }
    }

    // 🔒 CRITICAL: ตรวจสอบว่า Instagram account นี้ถูกใช้โดย organization อื่นแล้วหรือยัง
    const existingPlatform = await this.prisma.platform.findFirst({
      where: {
        type: 'instagram',
        pageId: accountId,
        organizationId: { not: organizationId },
        isActive: true,
      },
      include: {
        organization: {
          select: {
            name: true,
          },
        },
      },
    });

    if (existingPlatform) {
      this.logger.error(`❌ Instagram account ${accountId} is already connected to organization: ${existingPlatform.organization.name}`);
      throw new BadRequestException(
        `This Instagram account is already connected to another organization (${existingPlatform.organization.name}). ` +
        `Each account can only be connected to one organization at a time. ` +
        `Please disconnect it from the other organization first.`
      );
    }

    const platform = await this.prisma.platform.upsert({
      where: {
        organizationId_type_pageId: {
          organizationId,
          type: 'instagram',
          pageId: accountId,
        },
      },
      update: {
        accessToken,
        isActive: true,
        credentials: igInfo ? {
          instagramAccountId: accountId, // ✅ ใช้ชื่อนี้เพื่อให้ตรงกับ messaging service
          username: igInfo.username,
          name: igInfo.name,
          profilePicture: igInfo.profile_picture_url,
        } : { instagramAccountId: accountId },
      },
      create: {
        organizationId,
        type: 'instagram',
        pageId: accountId,
        accessToken,
        isActive: true,
        credentials: igInfo ? {
          instagramAccountId: accountId, // ✅ ใช้ชื่อนี้เพื่อให้ตรงกับ messaging service
          username: igInfo.username,
          name: igInfo.name,
          profilePicture: igInfo.profile_picture_url,
        } : { instagramAccountId: accountId },
      },
    });

    return {
      success: true,
      platform,
    };
  }

  async disconnectInstagramAccount(organizationId: string, accountId: string) {
    this.logger.log(`🔌 Disconnecting Instagram account: ${accountId} from org: ${organizationId}`);

    const platform = await this.prisma.platform.findFirst({
      where: {
        organizationId,
        type: 'instagram',
        pageId: accountId,
      },
    });

    if (!platform) {
      this.logger.warn(`⚠️ Platform not found: ${accountId} in org: ${organizationId}`);
      throw new NotFoundException('Platform not found');
    }

    await this.prisma.platform.update({
      where: { id: platform.id },
      data: { isActive: false },
    });

    return {
      success: true,
      message: 'Instagram account disconnected',
    };
  }

  // ==================== WHATSAPP ====================
  async getWhatsAppNumbers(organizationId: string) {
    this.logger.debug(`Getting WhatsApp numbers for org: ${organizationId}`);

    // 1. ดึง WhatsApp platforms ที่มีใน database
    const waPlatforms = await this.prisma.platform.findMany({
      where: {
        organizationId,
        type: 'whatsapp',
      },
      select: {
        id: true,
        pageId: true,
        isActive: true,
        accessToken: true,
        credentials: true,
        createdAt: true,
      },
    });

    // 2. ถ้ามี access token ให้ลองดึงจาก Meta API
    if (waPlatforms.length > 0 && waPlatforms[0].accessToken) {
      try {
        const accessToken = waPlatforms[0].accessToken;
        
        // ดึง WhatsApp Business Accounts ที่ user มีสิทธิ์เข้าถึง
        const response = await axios.get(
          'https://graph.facebook.com/v21.0/me/businesses',
          {
            params: {
              access_token: accessToken,
              fields: 'id,name,owned_whatsapp_business_accounts{id,name,timezone_id,message_template_namespace}',
            },
          },
        );

        const businesses = response.data.data || [];
        const wabaList: any[] = [];

        // รวบรวม WABA จากทุก business
        businesses.forEach((business: any) => {
          const wabas = business.owned_whatsapp_business_accounts?.data || [];
          wabas.forEach((waba: any) => {
            wabaList.push({
              wabaId: waba.id,
              wabaName: waba.name,
              businessId: business.id,
              businessName: business.name,
            });
          });
        });

        // ดึง phone numbers จากแต่ละ WABA
        const numbersPromises = wabaList.map(async (waba) => {
          try {
            const phoneResponse = await axios.get(
              `https://graph.facebook.com/v21.0/${waba.wabaId}/phone_numbers`,
              {
                params: {
                  access_token: accessToken,
                  fields: 'id,display_phone_number,verified_name,quality_rating,code_verification_status',
                },
              },
            );

            return (phoneResponse.data.data || []).map((phone: any) => {
              const existingPlatform = waPlatforms.find(p => p.pageId === phone.id);
              return {
                id: phone.id,
                phoneNumber: phone.display_phone_number,
                displayName: phone.verified_name,
                wabaId: waba.wabaId,
                wabaName: waba.wabaName,
                qualityRating: phone.quality_rating,
                verificationStatus: phone.code_verification_status,
                connected: !!existingPlatform && existingPlatform.isActive,
                platformId: existingPlatform?.id,
              };
            });
          } catch (error) {
            this.logger.warn(`Failed to fetch phone numbers for WABA ${waba.wabaId}:`, error.message);
            return [];
          }
        });

        const allNumbers = (await Promise.all(numbersPromises)).flat();
        
        if (allNumbers.length > 0) {
          return allNumbers;
        }
      } catch (error) {
        this.logger.warn('Failed to fetch WhatsApp numbers from API:', error.response?.data || error.message);
        // ถ้า API fail ให้ใช้ข้อมูลจาก database แทน
      }
    }

    // 3. Fallback: ใช้ข้อมูลจาก database
    return waPlatforms.map((p) => ({
      id: p.pageId,
      phoneNumber: p.credentials?.['phoneNumber'] || p.pageId,
      displayName: p.credentials?.['displayName'] || 'WhatsApp Business',
      wabaId: p.credentials?.['wabaId'],
      connected: p.isActive,
      platformId: p.id,
    }));
  }

  async connectWhatsAppNumber(organizationId: string, numberId: string) {
    this.logger.log(`Connecting WhatsApp number: ${numberId}`);

    // 🔒 CRITICAL: ตรวจสอบว่า WhatsApp number นี้ถูกใช้โดย organization อื่นแล้วหรือยัง
    const usedByOther = await this.prisma.platform.findFirst({
      where: {
        type: 'whatsapp',
        pageId: numberId,
        organizationId: { not: organizationId },
        isActive: true,
      },
      include: {
        organization: {
          select: {
            name: true,
          },
        },
      },
    });

    if (usedByOther) {
      this.logger.error(`❌ WhatsApp number ${numberId} is already connected to organization: ${usedByOther.organization.name}`);
      throw new BadRequestException(
        `This WhatsApp number is already connected to another organization (${usedByOther.organization.name}). ` +
        `Each number can only be connected to one organization at a time. ` +
        `Please disconnect it from the other organization first.`
      );
    }

    // WhatsApp จะถูก connect ผ่าน OAuth flow แล้วส่ง credentials มา
    // ที่นี่แค่ activate platform ที่มีอยู่แล้ว
    const existingPlatform = await this.prisma.platform.findFirst({
      where: {
        organizationId,
        type: 'whatsapp',
        pageId: numberId,
      },
    });

    if (existingPlatform) {
      // Activate existing platform
      const platform = await this.prisma.platform.update({
        where: { id: existingPlatform.id },
        data: { isActive: true },
      });

      return {
        success: true,
        platform,
      };
    }

    // ถ้ายังไม่มี ให้สร้างใหม่ (placeholder)
    const platform = await this.prisma.platform.create({
      data: {
        organizationId,
        type: 'whatsapp',
        pageId: numberId,
        accessToken: '', // จะต้องมาจาก OAuth
        isActive: true,
        credentials: {
          phoneNumberId: numberId,
          displayName: 'WhatsApp Business',
        },
      },
    });

    return {
      success: true,
      platform,
      message: 'WhatsApp number connected. Please configure credentials in settings.',
    };
  }

  async disconnectWhatsAppNumber(organizationId: string, numberId: string) {
    this.logger.log(`Disconnecting WhatsApp number: ${numberId}`);

    const platform = await this.prisma.platform.findFirst({
      where: {
        organizationId,
        type: 'whatsapp',
        pageId: numberId,
      },
    });

    if (!platform) {
      throw new NotFoundException('Platform not found');
    }

    await this.prisma.platform.update({
      where: { id: platform.id },
      data: { isActive: false },
    });

    return {
      success: true,
      message: 'WhatsApp number disconnected',
    };
  }

  /**
   * เพิ่ม WhatsApp แบบ Manual Configuration (สำหรับ Test Mode)
   */
  async addWhatsAppManual(
    organizationId: string,
    data: {
      phoneNumberId: string;
      accessToken: string;
      displayName?: string;
      phoneNumber?: string;
      wabaId?: string;
      verifiedName?: string;
    },
  ) {
    this.logger.log(`📱 Adding WhatsApp manually for org: ${organizationId}`);

    // Validate organization
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    // 🔒 CRITICAL: ตรวจสอบว่า WhatsApp number นี้ถูกใช้โดย organization อื่นแล้วหรือยัง
    const usedByOther = await this.prisma.platform.findFirst({
      where: {
        type: 'whatsapp',
        pageId: data.phoneNumberId,
        organizationId: { not: organizationId },
        isActive: true,
      },
      include: {
        organization: {
          select: {
            name: true,
          },
        },
      },
    });

    if (usedByOther) {
      this.logger.error(`❌ WhatsApp number ${data.phoneNumberId} is already connected to organization: ${usedByOther.organization.name}`);
      throw new BadRequestException(
        `This WhatsApp number is already connected to another organization (${usedByOther.organization.name}). ` +
        `Each number can only be connected to one organization at a time. ` +
        `Please disconnect it from the other organization first.`
      );
    }

    // ตรวจสอบว่ามี WhatsApp number นี้อยู่แล้วหรือไม่ (ใน org เดียวกัน)
    const existing = await this.prisma.platform.findFirst({
      where: {
        organizationId,
        type: 'whatsapp',
        pageId: data.phoneNumberId,
      },
    });

    if (existing) {
      // Update existing
      this.logger.log(`Updating existing WhatsApp platform: ${existing.id}`);
      const updated = await this.prisma.platform.update({
        where: { id: existing.id },
        data: {
          accessToken: data.accessToken,
          isActive: true,
          credentials: {
            phoneNumberId: data.phoneNumberId,
            displayName: data.displayName || 'WhatsApp Business',
            phoneNumber: data.phoneNumber,
            wabaId: data.wabaId,
            verifiedName: data.verifiedName,
          },
        },
      });

      return {
        success: true,
        platform: updated,
        message: 'WhatsApp platform updated successfully',
      };
    }

    // สร้างใหม่
    this.logger.log(`Creating new WhatsApp platform with Phone Number ID: ${data.phoneNumberId}`);
    const platform = await this.prisma.platform.create({
      data: {
        organizationId,
        type: 'whatsapp',
        pageId: data.phoneNumberId,
        accessToken: data.accessToken,
        isActive: true,
        credentials: {
          phoneNumberId: data.phoneNumberId,
          displayName: data.displayName || 'WhatsApp Business',
          phoneNumber: data.phoneNumber,
          wabaId: data.wabaId,
          verifiedName: data.verifiedName,
        },
      },
    });

    this.logger.log(`✅ WhatsApp platform created: ${platform.id}`);

    return {
      success: true,
      platform,
      message: 'WhatsApp connected successfully! You can now receive messages.',
    };
  }
}
