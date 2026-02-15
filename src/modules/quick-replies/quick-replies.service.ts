import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

type DefaultQuickReply = {
  shortcut: string;
  content: string;
  category: string;
};

const DEFAULT_QUICK_REPLIES: DefaultQuickReply[] = [
  {
    shortcut: '/hello',
    content: 'Hello! How can I help you today?',
    category: 'general',
  },
  {
    shortcut: '/thanks',
    content: 'Thank you for contacting us. We appreciate your message.',
    category: 'closing',
  },
  {
    shortcut: '/followup',
    content: 'I will follow up and update you as soon as possible.',
    category: 'support',
  },
];

@Injectable()
export class QuickRepliesService {
  constructor(private readonly prisma: PrismaService) {}

  private buildDefaultReplies(organizationId: string) {
    return DEFAULT_QUICK_REPLIES.map((item) => ({
      id: `default:${item.shortcut.replace('/', '')}`,
      organizationId,
      shortcut: item.shortcut,
      content: item.content,
      category: item.category,
      isActive: true,
      isDefault: true,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }));
  }

  private isDefaultId(id: string) {
    return id.startsWith('default:');
  }

  async list(organizationId: string) {
    const customReplies = await this.prisma.quickReply.findMany({
      where: {
        organizationId,
        isActive: true,
      },
      orderBy: {
        category: 'asc',
      },
    });

    const normalizedCustom = customReplies.map((item) => ({
      ...item,
      isDefault: false,
    }));
    const defaults = this.buildDefaultReplies(organizationId);

    return [...defaults, ...normalizedCustom];
  }

  async create(
    organizationId: string,
    data: {
      shortcut: string;
      content: string;
      category?: string;
    },
  ) {
    const normalizedShortcut = (data.shortcut || '').trim();
    if (!normalizedShortcut) {
      throw new BadRequestException('Shortcut is required');
    }

    const defaultShortcuts = new Set(
      DEFAULT_QUICK_REPLIES.map((item) => item.shortcut.toLowerCase()),
    );
    if (defaultShortcuts.has(normalizedShortcut.toLowerCase())) {
      throw new BadRequestException('This shortcut is reserved by default quick replies');
    }

    return this.prisma.quickReply.create({
      data: {
        organizationId,
        shortcut: normalizedShortcut,
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
    if (this.isDefaultId(id)) {
      throw new BadRequestException('Default quick replies cannot be edited');
    }

    return this.prisma.quickReply.update({
      where: {
        id,
        organizationId,
      },
      data,
    });
  }

  async delete(organizationId: string, id: string) {
    if (this.isDefaultId(id)) {
      throw new BadRequestException('Default quick replies cannot be deleted');
    }

    return this.prisma.quickReply.delete({
      where: {
        id,
        organizationId,
      },
    });
  }

  async search(organizationId: string, query: string) {
    const customReplies = await this.prisma.quickReply.findMany({
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

    const normalizedQuery = (query || '').toLowerCase();
    const defaultReplies = this.buildDefaultReplies(organizationId).filter(
      (item) =>
        item.shortcut.toLowerCase().includes(normalizedQuery) ||
        item.content.toLowerCase().includes(normalizedQuery),
    );

    return [
      ...defaultReplies,
      ...customReplies.map((item) => ({ ...item, isDefault: false })),
    ].slice(0, 10);
  }
}
