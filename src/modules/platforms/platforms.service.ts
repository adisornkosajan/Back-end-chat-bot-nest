import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PlatformsService {
  private readonly logger = new Logger(PlatformsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(organizationId: string) {
    this.logger.debug(`Finding all platforms for org: ${organizationId}`);
    return this.prisma.platform.findMany({
      where: {
        organizationId,
        isActive: true,
      },
      select: {
        id: true,
        type: true,
        pageId: true,
        credentials: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(organizationId: string, id: string) {
    this.logger.debug(`Finding platform: ${id} for org: ${organizationId}`);
    const platform = await this.prisma.platform.findFirst({
      where: {
        id,
        organizationId,
      },
      select: {
        id: true,
        type: true,
        pageId: true,
        credentials: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!platform) {
      throw new NotFoundException('Platform not found');
    }

    return platform;
  }

  async update(
    organizationId: string,
    id: string,
    data: { displayName?: string; credentials?: any },
  ) {
    this.logger.log(`Updating platform: ${id}`);

    const platform = await this.findOne(organizationId, id);

    const updatedPlatform = await this.prisma.platform.update({
      where: { id },
      data: {
        credentials: data.credentials
          ? { ...(platform.credentials as object), ...data.credentials }
          : platform.credentials,
      },
    });

    return {
      success: true,
      platform: updatedPlatform,
    };
  }

  async disconnect(organizationId: string, id: string) {
    this.logger.log(`Disconnecting platform: ${id}`);
    
    const platform = await this.findOne(organizationId, id);
    
    await this.prisma.platform.update({
      where: { id },
      data: { isActive: false },
    });

    return {
      success: true,
      message: 'Platform disconnected successfully',
    };
  }

  async findByTypeAndPageId(
    organizationId: string,
    type: string,
    pageId: string,
  ) {
    return this.prisma.platform.findFirst({
      where: {
        organizationId,
        type,
        pageId,
        isActive: true,
      },
    });
  }
}
