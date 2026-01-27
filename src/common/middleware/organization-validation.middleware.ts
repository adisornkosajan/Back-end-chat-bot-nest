import { Injectable, NestMiddleware, UnauthorizedException, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class OrganizationValidationMiddleware implements NestMiddleware {
  private readonly logger = new Logger(OrganizationValidationMiddleware.name);

  constructor(private prisma: PrismaService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const user = (req as any).user;

    if (!user || !user.organizationId) {
      this.logger.warn('⚠️ Request without valid user/organizationId');
      return next();
    }

    // Verify that the organization still exists
    const organization = await this.prisma.organization.findUnique({
      where: { id: user.organizationId },
    });

    if (!organization) {
      this.logger.error(`❌ Organization not found: ${user.organizationId}`);
      throw new UnauthorizedException('Organization not found. Please contact support.');
    }

    // Verify that the user still belongs to this organization
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.userId },
    });

    if (!dbUser || dbUser.organizationId !== user.organizationId) {
      this.logger.error(`❌ User ${user.userId} does not belong to org ${user.organizationId}`);
      throw new UnauthorizedException('Invalid organization access');
    }

    // Add organization info to request
    (req as any).organization = organization;
    
    this.logger.debug(`✅ Validated user ${user.userId} in org ${organization.name}`);
    next();
  }
}
