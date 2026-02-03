import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PluginsService {
  constructor(private prisma: PrismaService) {}

  async findAll(organizationId: string) {
    return this.prisma.plugin.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, organizationId: string) {
    const plugin = await this.prisma.plugin.findFirst({
      where: { id, organizationId },
    });

    if (!plugin) {
      throw new NotFoundException('Plugin not found');
    }

    return plugin;
  }

  async create(
    organizationId: string,
    userId: string,
    data: {
      name: string;
      type: string;
      description?: string;
      apiKey?: string;
      apiSecret?: string;
      config?: any;
    }
  ) {
    return this.prisma.plugin.create({
      data: {
        organizationId,
        createdBy: userId,
        name: data.name,
        type: data.type,
        description: data.description,
        apiKey: data.apiKey,
        apiSecret: data.apiSecret,
        config: data.config,
        isActive: true,
      },
    });
  }

  async update(
    id: string,
    organizationId: string,
    data: {
      name?: string;
      type?: string;
      description?: string;
      apiKey?: string;
      apiSecret?: string;
      config?: any;
      isActive?: boolean;
    }
  ) {
    const plugin = await this.findOne(id, organizationId);

    return this.prisma.plugin.update({
      where: { id: plugin.id },
      data,
    });
  }

  async delete(id: string, organizationId: string) {
    const plugin = await this.findOne(id, organizationId);

    await this.prisma.plugin.delete({
      where: { id: plugin.id },
    });

    return { message: 'Plugin deleted successfully' };
  }

  async toggleActive(id: string, organizationId: string) {
    const plugin = await this.findOne(id, organizationId);

    return this.prisma.plugin.update({
      where: { id: plugin.id },
      data: { isActive: !plugin.isActive },
    });
  }
}
