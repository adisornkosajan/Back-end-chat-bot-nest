import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { LicenseStatus, PlanTier } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

const FEATURE_MATRIX: Record<PlanTier, string[]> = {
  TRIAL: ['INBOX', 'NOTES', 'QUICK_REPLIES'],
  BASIC: ['INBOX', 'NOTES', 'QUICK_REPLIES', 'ANALYTICS', 'TEAM'],
  PRO: [
    'INBOX',
    'NOTES',
    'QUICK_REPLIES',
    'ANALYTICS',
    'TEAM',
    'AI_SETTINGS',
    'PLUGINS',
    'INTEGRATIONS',
  ],
  ENTERPRISE: ['*'],
};

@Injectable()
export class LicensingService {
  private readonly logger = new Logger(LicensingService.name);

  constructor(private readonly prisma: PrismaService) {}

  private generateLicenseKey(): string {
    return `OMNI-${randomBytes(4).toString('hex').toUpperCase()}-${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private getPlanDurationDays(plan: PlanTier): number {
    if (plan === PlanTier.TRIAL) return 14;
    if (plan === PlanTier.BASIC) return 30;
    if (plan === PlanTier.PRO) return 30;
    return 365;
  }

  private getDefaultQuota(plan: PlanTier): number {
    if (plan === PlanTier.TRIAL) return 1000;
    if (plan === PlanTier.BASIC) return 10000;
    if (plan === PlanTier.PRO) return 100000;
    return 1000000;
  }

  async getOrCreateCurrentLicense(organizationId: string) {
    const current = await this.prisma.license.findFirst({
      where: {
        organizationId,
        status: {
          in: [LicenseStatus.ACTIVE, LicenseStatus.SUSPENDED],
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!current) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      this.logger.log(`Creating default TRIAL license for org ${organizationId}`);
      return this.prisma.license.create({
        data: {
          organizationId,
          licenseKey: this.generateLicenseKey(),
          plan: PlanTier.TRIAL,
          status: LicenseStatus.ACTIVE,
          seats: 3,
          usedSeats: 1,
          messageQuota: this.getDefaultQuota(PlanTier.TRIAL),
          periodStart: now,
          expiresAt,
          activatedAt: now,
        },
      });
    }

    if (current.status === LicenseStatus.ACTIVE && current.expiresAt < new Date()) {
      return this.prisma.license.update({
        where: { id: current.id },
        data: { status: LicenseStatus.EXPIRED },
      });
    }

    return current;
  }

  async validateLicense(organizationId: string) {
    const license = await this.getOrCreateCurrentLicense(organizationId);
    if (!license) {
      throw new ForbiddenException('License not found');
    }

    if (license.status === LicenseStatus.SUSPENDED) {
      throw new ForbiddenException(
        `License is suspended${license.suspendedReason ? `: ${license.suspendedReason}` : ''}`,
      );
    }

    if (license.status !== LicenseStatus.ACTIVE) {
      throw new ForbiddenException('License is not active');
    }

    if (license.expiresAt < new Date()) {
      await this.prisma.license.update({
        where: { id: license.id },
        data: { status: LicenseStatus.EXPIRED },
      });
      throw new ForbiddenException('License has expired');
    }

    return license;
  }

  async hasFeatureAccess(organizationId: string, feature: string): Promise<boolean> {
    try {
      const license = await this.validateLicense(organizationId);
      const features = FEATURE_MATRIX[license.plan];
      return features.includes('*') || features.includes(feature);
    } catch {
      return false;
    }
  }

  async createLicense(
    organizationId: string,
    data: { plan: PlanTier; seats?: number; expiresAt?: string },
    createdBy?: string,
  ) {
    const plan = data.plan ?? PlanTier.TRIAL;
    const seats = data.seats ?? 1;
    const now = new Date();
    const expiresAt = data.expiresAt
      ? new Date(data.expiresAt)
      : new Date(now.getTime() + this.getPlanDurationDays(plan) * 24 * 60 * 60 * 1000);

    return this.prisma.license.create({
      data: {
        organizationId,
        licenseKey: this.generateLicenseKey(),
        plan,
        status: LicenseStatus.ACTIVE,
        seats,
        usedSeats: 1,
        messageQuota: this.getDefaultQuota(plan),
        periodStart: now,
        expiresAt,
        activatedAt: now,
        createdBy,
      },
    });
  }

  async activateLicense(organizationId: string, licenseKey: string) {
    const license = await this.prisma.license.findUnique({
      where: { licenseKey },
    });
    if (!license) {
      throw new NotFoundException('License key not found');
    }
    if (license.organizationId !== organizationId) {
      throw new ForbiddenException('License does not belong to this organization');
    }

    return this.prisma.license.update({
      where: { id: license.id },
      data: {
        status: LicenseStatus.ACTIVE,
        activatedAt: new Date(),
      },
    });
  }

  async renewLicense(organizationId: string, days = 30) {
    const license = await this.validateLicense(organizationId);
    const base = license.expiresAt > new Date() ? license.expiresAt : new Date();
    const expiresAt = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

    return this.prisma.license.update({
      where: { id: license.id },
      data: { expiresAt, status: LicenseStatus.ACTIVE },
    });
  }

  async suspendLicense(organizationId: string, reason?: string) {
    const license = await this.getOrCreateCurrentLicense(organizationId);
    return this.prisma.license.update({
      where: { id: license.id },
      data: {
        status: LicenseStatus.SUSPENDED,
        suspendedReason: reason ?? null,
      },
    });
  }

  async assignSeat(organizationId: string) {
    const license = await this.validateLicense(organizationId);
    if (license.usedSeats >= license.seats) {
      throw new ForbiddenException('No available seats left');
    }

    return this.prisma.license.update({
      where: { id: license.id },
      data: { usedSeats: { increment: 1 } },
    });
  }

  async revokeSeat(organizationId: string) {
    const license = await this.validateLicense(organizationId);
    if (license.usedSeats <= 1) {
      throw new ForbiddenException('Cannot revoke the last seat');
    }

    return this.prisma.license.update({
      where: { id: license.id },
      data: { usedSeats: { decrement: 1 } },
    });
  }

  async consumeMessageQuota(organizationId: string, amount = 1) {
    const license = await this.validateLicense(organizationId);
    const nextUsed = license.messageUsed + amount;
    if (nextUsed > license.messageQuota) {
      throw new ForbiddenException('Message quota exceeded');
    }

    return this.prisma.license.update({
      where: { id: license.id },
      data: { messageUsed: { increment: amount } },
    });
  }

  async getLicenseUsage(organizationId: string) {
    const license = await this.getOrCreateCurrentLicense(organizationId);
    return {
      licenseId: license.id,
      plan: license.plan,
      status: license.status,
      seats: license.seats,
      usedSeats: license.usedSeats,
      messageQuota: license.messageQuota,
      messageUsed: license.messageUsed,
      expiresAt: license.expiresAt,
      features: FEATURE_MATRIX[license.plan],
    };
  }
}

