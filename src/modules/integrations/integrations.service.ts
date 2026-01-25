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
    this.logger.log(`Connecting Facebook page: ${pageId}`);

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
    this.logger.log(`Connecting Instagram account: ${accountId}`);

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
          username: igInfo.username,
          name: igInfo.name,
          profilePicture: igInfo.profile_picture_url,
          accountId: accountId,
        } : undefined,
      },
      create: {
        organizationId,
        type: 'instagram',
        pageId: accountId,
        accessToken,
        isActive: true,
        credentials: igInfo ? {
          username: igInfo.username,
          name: igInfo.name,
          profilePicture: igInfo.profile_picture_url,
          accountId: accountId,
        } : { accountId },
      },
    });

    return {
      success: true,
      platform,
    };
  }

  async disconnectInstagramAccount(organizationId: string, accountId: string) {
    this.logger.log(`Disconnecting Instagram account: ${accountId}`);

    const platform = await this.prisma.platform.findFirst({
      where: {
        organizationId,
        type: 'instagram',
        pageId: accountId,
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
      message: 'Instagram account disconnected',
    };
  }

  // ==================== WHATSAPP ====================
  async getWhatsAppNumbers(organizationId: string) {
    this.logger.debug(`Getting WhatsApp numbers for org: ${organizationId}`);

    const waPlatforms = await this.prisma.platform.findMany({
      where: {
        organizationId,
        type: 'whatsapp',
      },
      select: {
        id: true,
        pageId: true,
        isActive: true,
        credentials: true,
        createdAt: true,
      },
    });

    // WhatsApp ต้องใช้ WhatsApp Business API
    // ที่นี่จะ return platforms ที่มีอยู่แล้ว
    return waPlatforms.map((p) => ({
      id: p.pageId,
      phoneNumber: p.credentials?.['phoneNumber'] || p.pageId,
      displayName: p.credentials?.['displayName'] || 'WhatsApp Business',
      connected: p.isActive,
      platformId: p.id,
    }));
  }

  async connectWhatsAppNumber(organizationId: string, numberId: string) {
    this.logger.log(`Connecting WhatsApp number: ${numberId}`);

    // WhatsApp Business API requires manual setup
    // This is a placeholder for future implementation
    throw new BadRequestException(
      'WhatsApp connection requires manual setup. Please contact support.',
    );
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
}
