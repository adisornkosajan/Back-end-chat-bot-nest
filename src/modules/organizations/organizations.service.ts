import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    this.logger.debug(`🏢 Finding organization by ID: ${id}`);
    const org = await this.prisma.organization.findUnique({
      where: { id },
    });
    if (org) {
      this.logger.debug(`✅ Organization found: ${org.name}`);
    } else {
      this.logger.debug(`❌ Organization not found: ${id}`);
    }
    return org;
  }

  /**
   * Create a new organization with admin user
   * สำหรับ super admin/ผู้ให้บริการที่ต้องการสร้าง organization ให้ลูกค้า
   */
  async createOrganizationWithAdmin(data: {
    organizationName: string;
    adminName: string;
    adminEmail: string;
    adminPassword: string;
    role?: string;
  }) {
    this.logger.log(`🏢 Creating organization: ${data.organizationName} with admin: ${data.adminEmail}`);

    // Check if email already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.adminEmail },
    });

    if (existingUser) {
      throw new Error('Email already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(data.adminPassword, 10);

    // Create organization and admin user in a transaction
    const result = await this.prisma.$transaction(async (prisma) => {
      // Create organization
      const organization = await prisma.organization.create({
        data: {
          name: data.organizationName,
        },
      });

      // Create admin user
      const user = await prisma.user.create({
        data: {
          email: data.adminEmail,
          name: data.adminName,
          passwordHash,
          organizationId: organization.id,
          role: data.role || 'ADMIN',
        },
      });

      return { organization, user };
    });

    this.logger.log(`✅ Created organization ${result.organization.id} with admin user ${result.user.id}`);

    return result;
  }

  /**
   * Add user to existing organization
   * สำหรับเพิ่มสมาชิกเข้า organization โดยตรง
   */
  async addUserToOrganization(
    organizationId: string,
    data: {
      name: string;
      email: string;
      password: string;
      role?: string;
    }
  ) {
    this.logger.log(`👤 Adding user ${data.email} to organization ${organizationId}`);

    // Check if organization exists
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      throw new Error('Organization not found');
    }

    // Check if email already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new Error('Email already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, 10);

    // Create user
    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        passwordHash,
        organizationId,
        role: data.role || 'user',
      },
    });

    this.logger.log(`✅ Added user ${user.id} to organization ${organizationId}`);

    return user;
  }

  /**
   * Get all organizations (for super admin)
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
}
