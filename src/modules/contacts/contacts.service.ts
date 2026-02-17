import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List all contacts for an organization with search, filter, pagination
   */
  async listContacts(
    organizationId: string,
    options?: {
      search?: string;
      tagIds?: string[];
      platformId?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const page = options?.page || 1;
    const limit = options?.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = { organizationId };

    // Search by name, email, phone
    if (options?.search) {
      where.OR = [
        { name: { contains: options.search } },
        { email: { contains: options.search } },
        { phone: { contains: options.search } },
        { externalId: { contains: options.search } },
      ];
    }

    // Filter by platform
    if (options?.platformId) {
      where.platformId = options.platformId;
    }

    // Filter by tags
    if (options?.tagIds && options.tagIds.length > 0) {
      where.customerTags = {
        some: {
          tagId: { in: options.tagIds },
        },
      };
    }

    const [customers, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        include: {
          platform: { select: { id: true, type: true, pageId: true } },
          customerTags: {
            include: {
              tag: true,
            },
          },
          _count: {
            select: { conversations: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      data: customers.map((c) => ({
        ...c,
        tags: c.customerTags.map((ct) => ct.tag),
        conversationCount: c._count.conversations,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get a single contact by ID with full details
   */
  async getContact(organizationId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId },
      include: {
        platform: { select: { id: true, type: true, pageId: true } },
        customerTags: { include: { tag: true } },
        conversations: {
          orderBy: { lastMessageAt: 'desc' },
          take: 10,
          include: {
            messages: { orderBy: { sentAt: 'desc' }, take: 1 },
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('Contact not found');
    }

    return {
      ...customer,
      tags: customer.customerTags.map((ct) => ct.tag),
    };
  }

  /**
   * Update contact info
   */
  async updateContact(
    organizationId: string,
    customerId: string,
    data: { name?: string; email?: string; phone?: string },
  ) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId },
    });

    if (!customer) {
      throw new NotFoundException('Contact not found');
    }

    return this.prisma.customer.update({
      where: { id: customerId },
      data,
      include: {
        platform: { select: { id: true, type: true, pageId: true } },
        customerTags: { include: { tag: true } },
      },
    });
  }

  // ==================== TAGS ====================

  /**
   * List all tags for an organization
   */
  async listTags(organizationId: string) {
    const tags = await this.prisma.tag.findMany({
      where: { organizationId },
      include: {
        _count: { select: { customerTags: true } },
      },
      orderBy: { name: 'asc' },
    });

    return tags.map((t) => ({
      ...t,
      customerCount: t._count.customerTags,
    }));
  }

  /**
   * Create a new tag
   */
  async createTag(
    organizationId: string,
    data: { name: string; color?: string },
  ) {
    const existing = await this.prisma.tag.findUnique({
      where: {
        organizationId_name: { organizationId, name: data.name },
      },
    });

    if (existing) {
      throw new BadRequestException('Tag with this name already exists');
    }

    return this.prisma.tag.create({
      data: {
        organizationId,
        name: data.name,
        color: data.color || '#3B82F6',
      },
    });
  }

  /**
   * Update a tag
   */
  async updateTag(
    organizationId: string,
    tagId: string,
    data: { name?: string; color?: string },
  ) {
    const tag = await this.prisma.tag.findFirst({
      where: { id: tagId, organizationId },
    });

    if (!tag) {
      throw new NotFoundException('Tag not found');
    }

    return this.prisma.tag.update({
      where: { id: tagId },
      data,
    });
  }

  /**
   * Delete a tag
   */
  async deleteTag(organizationId: string, tagId: string) {
    const tag = await this.prisma.tag.findFirst({
      where: { id: tagId, organizationId },
    });

    if (!tag) {
      throw new NotFoundException('Tag not found');
    }

    await this.prisma.tag.delete({ where: { id: tagId } });
    return { message: 'Tag deleted successfully' };
  }

  /**
   * Add tag to a customer
   */
  async addTagToCustomer(
    organizationId: string,
    customerId: string,
    tagId: string,
  ) {
    // Verify customer and tag belong to organization
    const [customer, tag] = await Promise.all([
      this.prisma.customer.findFirst({ where: { id: customerId, organizationId } }),
      this.prisma.tag.findFirst({ where: { id: tagId, organizationId } }),
    ]);

    if (!customer) throw new NotFoundException('Contact not found');
    if (!tag) throw new NotFoundException('Tag not found');

    // Check if already tagged
    const existing = await this.prisma.customerTag.findUnique({
      where: { customerId_tagId: { customerId, tagId } },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.customerTag.create({
      data: { customerId, tagId },
      include: { tag: true },
    });
  }

  /**
   * Remove tag from a customer
   */
  async removeTagFromCustomer(
    organizationId: string,
    customerId: string,
    tagId: string,
  ) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId },
    });

    if (!customer) throw new NotFoundException('Contact not found');

    const customerTag = await this.prisma.customerTag.findUnique({
      where: { customerId_tagId: { customerId, tagId } },
    });

    if (!customerTag) {
      throw new NotFoundException('Tag not assigned to this contact');
    }

    await this.prisma.customerTag.delete({
      where: { id: customerTag.id },
    });

    return { message: 'Tag removed from contact' };
  }

  /**
   * Get contacts count summary
   */
  async getContactStats(organizationId: string) {
    const [totalContacts, contactsByPlatform] = await Promise.all([
      this.prisma.customer.count({ where: { organizationId } }),
      this.prisma.customer.groupBy({
        by: ['platformId'],
        where: { organizationId },
        _count: { id: true },
      }),
    ]);

    const platformIds = contactsByPlatform.map((p) => p.platformId);
    const platforms = await this.prisma.platform.findMany({
      where: { id: { in: platformIds } },
      select: { id: true, type: true },
    });

    return {
      total: totalContacts,
      byPlatform: contactsByPlatform.map((p) => ({
        platform: platforms.find((pl) => pl.id === p.platformId)?.type || 'Unknown',
        count: p._count.id,
      })),
    };
  }
}
