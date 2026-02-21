import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

type OrganizationSocialContacts = {
  facebook: string[];
  instagram: string[];
  whatsapp: string[];
};

type UpdateOrganizationData = {
  name?: string;
  address?: string;
  contact?: string;
  trn?: string;
  description?: string;
  socialContacts?: {
    facebook?: string[];
    instagram?: string[];
    whatsapp?: string[];
  };
};

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    this.logger.debug(`Finding organization by ID: ${id}`);

    const org = await this.prisma.organization.findUnique({
      where: { id },
    });

    if (org) {
      this.logger.debug(`Organization found: ${org.name}`);
    } else {
      this.logger.debug(`Organization not found: ${id}`);
    }

    return org;
  }

  /**
   * Create a new organization with admin user.
   */
  async createOrganizationWithAdmin(data: {
    organizationName: string;
    adminName: string;
    adminEmail: string;
    adminPassword: string;
    role?: string;
  }) {
    this.logger.log(`Creating organization: ${data.organizationName} with admin: ${data.adminEmail}`);

    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.adminEmail },
    });

    if (existingUser) {
      throw new Error('Email already exists');
    }

    const passwordHash = await bcrypt.hash(data.adminPassword, 10);

    const result = await this.prisma.$transaction(async (prisma) => {
      const organization = await prisma.organization.create({
        data: {
          name: data.organizationName,
        },
      });

      const user = await prisma.user.create({
        data: {
          email: data.adminEmail,
          name: data.adminName,
          passwordHash,
          organizationId: organization.id,
          role: (data.role as any) || 'ADMIN',
        },
      });

      return { organization, user };
    });

    this.logger.log(`Created organization ${result.organization.id} with admin user ${result.user.id}`);

    return result;
  }

  /**
   * Add user to existing organization.
   */
  async addUserToOrganization(
    organizationId: string,
    data: {
      name: string;
      email: string;
      password: string;
      role?: string;
    },
  ) {
    this.logger.log(`Adding user ${data.email} to organization ${organizationId}`);

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      throw new Error('Organization not found');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new Error('Email already exists');
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        passwordHash,
        organizationId,
        role: (data.role as any) || 'USER',
      },
    });

    this.logger.log(`Added user ${user.id} to organization ${organizationId}`);

    return user;
  }

  /**
   * Get all organizations (for super admin).
   */
  async getAllOrganizations() {
    return this.prisma.organization.findMany({
      include: {
        _count: {
          select: {
            users: true,
            platforms: true,
            conversations: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Update organization details.
   */
  async updateOrganization(organizationId: string, data: UpdateOrganizationData) {
    this.logger.log(`Updating organization ${organizationId}`);

    if (data.name) {
      const existingOrg = await this.prisma.organization.findFirst({
        where: {
          name: data.name,
          id: { not: organizationId },
        },
      });

      if (existingOrg) {
        throw new Error('Organization name already exists');
      }
    }

    const updateData: Prisma.OrganizationUpdateInput = {};

    if (Object.prototype.hasOwnProperty.call(data, 'name')) {
      updateData.name = data.name;
    }

    if (Object.prototype.hasOwnProperty.call(data, 'address')) {
      updateData.address = data.address;
    }

    if (Object.prototype.hasOwnProperty.call(data, 'contact')) {
      updateData.contact = data.contact?.trim() || null;
    }

    if (Object.prototype.hasOwnProperty.call(data, 'trn')) {
      updateData.trn = data.trn;
    }

    if (Object.prototype.hasOwnProperty.call(data, 'description')) {
      updateData.description = data.description;
    }

    if (Object.prototype.hasOwnProperty.call(data, 'socialContacts')) {
      const normalizedSocialContacts = this.normalizeSocialContacts(data.socialContacts);
      updateData.socialContacts = normalizedSocialContacts
        ? (normalizedSocialContacts as Prisma.InputJsonValue)
        : Prisma.JsonNull;

      // Keep legacy "contact" available for older screens/integrations.
      if (!Object.prototype.hasOwnProperty.call(data, 'contact')) {
        updateData.contact =
          normalizedSocialContacts?.whatsapp[0] ||
          normalizedSocialContacts?.facebook[0] ||
          normalizedSocialContacts?.instagram[0] ||
          null;
      }
    }

    const organization = await this.prisma.organization.update({
      where: { id: organizationId },
      data: updateData,
    });

    this.logger.log(`Updated organization ${organizationId}`);

    return organization;
  }

  private normalizeSocialContacts(
    input:
      | {
          facebook?: string[];
          instagram?: string[];
          whatsapp?: string[];
        }
      | undefined,
  ): OrganizationSocialContacts | null {
    if (!input) {
      return null;
    }

    const facebook = this.normalizeContactList(input.facebook);
    const instagram = this.normalizeContactList(input.instagram);
    const whatsapp = this.normalizeContactList(input.whatsapp);

    if (!facebook.length && !instagram.length && !whatsapp.length) {
      return null;
    }

    return {
      facebook,
      instagram,
      whatsapp,
    };
  }

  private normalizeContactList(values: string[] | undefined): string[] {
    if (!Array.isArray(values)) {
      return [];
    }

    const normalized: string[] = [];
    const seen = new Set<string>();

    for (const value of values) {
      if (typeof value !== 'string') {
        continue;
      }

      const trimmedValue = value.trim();
      if (!trimmedValue || seen.has(trimmedValue)) {
        continue;
      }

      seen.add(trimmedValue);
      normalized.push(trimmedValue);
    }

    return normalized;
  }
}
