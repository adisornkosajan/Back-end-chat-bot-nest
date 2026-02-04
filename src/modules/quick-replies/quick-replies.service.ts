import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class QuickRepliesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string) {
    return this.prisma.quickReply.findMany({
      where: {
        organizationId,
        isActive: true,
      },
      orderBy: {
        category: 'asc',
      },
    });
  }

  async create(
    organizationId: string,
    data: {
      shortcut: string;
      content: string;
      category?: string;
    },
  ) {
    return this.prisma.quickReply.create({
      data: {
        organizationId,
        shortcut: data.shortcut,
        content: data.content,
        category: data.category || 'general',
      },
    });
  }

  async update(
    organizationId: string,
    id: string,
    data: {
      shortcut?: string;
      content?: string;
      category?: string;
      isActive?: boolean;
    },
  ) {
    return this.prisma.quickReply.update({
      where: {
        id,
        organizationId,
      },
      data,
    });
  }

  async delete(organizationId: string, id: string) {
    return this.prisma.quickReply.delete({
      where: {
        id,
        organizationId,
      },
    });
  }

  async search(organizationId: string, query: string) {
    return this.prisma.quickReply.findMany({
      where: {
        organizationId,
        isActive: true,
        OR: [
          { shortcut: { contains: query } },
          { content: { contains: query } },
        ],
      },
      take: 10,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
