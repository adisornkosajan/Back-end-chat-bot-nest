import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PlanTier, PlatformRole, UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { LicensingService } from '../licensing/licensing.service';

@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly licensingService: LicensingService,
    private readonly jwtService: JwtService,
  ) {}

  async listOrganizations() {
    return this.prisma.organization.findMany({
      include: {
        _count: {
          select: { users: true, conversations: true, platforms: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOrganizationDetail(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        users: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            platformRole: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!org) throw new NotFoundException('Organization not found');
    const license = await this.licensingService.getOrCreateCurrentLicense(organizationId);
    return { ...org, license };
  }

  async setOrganizationPlan(
    organizationId: string,
    data: { plan: PlanTier; seats?: number; days?: number },
    changedBy: string,
  ) {
    // Create a new active license for traceable plan changes.
    const license = await this.licensingService.createLicense(
      organizationId,
      {
        plan: data.plan,
        seats: data.seats,
      },
      changedBy,
    );

    if (data.days && data.days > 0) {
      await this.licensingService.renewLicense(organizationId, data.days);
    }

    return license;
  }

  async suspendOrganization(organizationId: string, reason?: string) {
    return this.licensingService.suspendLicense(organizationId, reason);
  }

  async setUserPlatformRole(userId: string, platformRole: PlatformRole) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.user.update({
      where: { id: userId },
      data: { platformRole },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        platformRole: true,
      },
    });
  }

  async setOwnerByEmail(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.user.update({
      where: { email },
      data: { platformRole: PlatformRole.OWNER },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        platformRole: true,
      },
    });
  }

  async bootstrapSuperAdmin(data: {
    email: string;
    password: string;
    name: string;
  }) {
    const existingSuperAdminCount = await this.prisma.user.count({
      where: {
        role: UserRole.SUPER_ADMIN,
      },
    });

    if (existingSuperAdminCount > 0) {
      throw new ConflictException('SUPER_ADMIN already exists');
    }

    if (!data.email || !data.password || !data.name) {
      throw new BadRequestException('email, password, and name are required');
    }

    if (data.password.length < 10) {
      throw new BadRequestException('password must be at least 10 characters');
    }

    const existingEmail = await this.prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existingEmail) {
      throw new ConflictException('Email already exists');
    }

    const platformOrgName =
      process.env.PLATFORM_SUPERADMIN_ORG_NAME || 'Platform System';

    const existingOrg = await this.prisma.organization.findFirst({
      where: { name: platformOrgName },
    });

    const platformOrg =
      existingOrg ||
      (await this.prisma.organization.create({
        data: { name: platformOrgName },
      }));

    const passwordHash = await bcrypt.hash(data.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        name: data.name,
        role: UserRole.SUPER_ADMIN,
        platformRole: PlatformRole.OWNER,
        organizationId: platformOrg.id,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        platformRole: true,
        organizationId: true,
        createdAt: true,
      },
    });

    return {
      success: true,
      message: 'SUPER_ADMIN bootstrap completed',
      user,
    };
  }

  private async writeAuditLog(data: {
    organizationId?: string | null;
    userId?: string | null;
    action: string;
    resource: string;
    resourceId?: string | null;
    metadata?: any;
    ipAddress?: string | null;
    userAgent?: string | null;
  }) {
    try {
      await this.prisma.$executeRawUnsafe(
        `
        INSERT INTO audit_logs (
          id, organizationId, userId, action, resource, resourceId,
          metadata, ipAddress, userAgent, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))
        `,
        randomUUID(),
        data.organizationId ?? null,
        data.userId ?? null,
        data.action,
        data.resource,
        data.resourceId ?? null,
        data.metadata ? JSON.stringify(data.metadata) : null,
        data.ipAddress ?? null,
        data.userAgent ?? null,
      );
    } catch {
      // Keep business flow alive even if audit table is unavailable in some environments.
    }
  }

  async createImpersonationToken(
    actor: any,
    organizationId: string,
    userAgent?: string,
    ipAddress?: string,
    options?: { reason?: string; asUserId?: string; expiresInMinutes?: number },
  ) {
    if (!actor || !actor.id) {
      throw new ForbiddenException('Invalid actor');
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        users: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    if (!org.users.length) {
      throw new ForbiddenException('Cannot impersonate organization without users');
    }

    let targetUser = org.users.find((u) => u.id === options?.asUserId);
    if (!targetUser) {
      targetUser =
        org.users.find((u) => u.role === 'ADMIN') ||
        org.users.find((u) => u.role === 'MANAGER') ||
        org.users[0];
    }

    const expiresInMinutes = Math.min(
      Math.max(options?.expiresInMinutes ?? 30, 5),
      180,
    );

    const payload = {
      sub: targetUser.id,
      organizationId: org.id,
      role: 'ADMIN', // OWNER/SUPPORT enters org with admin capability
      platformRole: actor.platformRole || 'NONE',
      impersonating: true,
      impersonatedByUserId: actor.id,
      impersonatedByOrgId: actor.organizationId,
      impersonatedByRole: actor.platformRole || 'NONE',
      impersonationReason: options?.reason || null,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: `${expiresInMinutes}m`,
    });

    await this.writeAuditLog({
      organizationId: org.id,
      userId: actor.id,
      action: 'IMPERSONATE_LOGIN',
      resource: 'organization',
      resourceId: org.id,
      metadata: {
        targetUserId: targetUser.id,
        targetUserEmail: targetUser.email,
        expiresInMinutes,
        reason: options?.reason || null,
      },
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
    });

    return {
      success: true,
      accessToken,
      expiresInMinutes,
      organization: {
        id: org.id,
        name: org.name,
      },
      impersonatedUser: {
        id: targetUser.id,
        email: targetUser.email,
        name: targetUser.name,
      },
      note: 'Use this token as Bearer token to access the target organization',
    };
  }
}
