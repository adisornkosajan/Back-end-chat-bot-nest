import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PlanTier } from '@prisma/client';
import { Roles, UserRole } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { LicensingService } from './licensing.service';

@Controller('licensing')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class LicensingController {
  constructor(private readonly licensingService: LicensingService) {}

  @Get('current')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async current(@Req() req: any) {
    return this.licensingService.getLicenseUsage(req.user.organizationId);
  }

  @Post('create')
  @Roles(UserRole.ADMIN)
  async create(
    @Req() req: any,
    @Body() body: { plan: PlanTier; seats?: number; expiresAt?: string },
  ) {
    return this.licensingService.createLicense(
      req.user.organizationId,
      body,
      req.user.id,
    );
  }

  @Post('activate')
  @Roles(UserRole.ADMIN)
  async activate(@Req() req: any, @Body() body: { licenseKey: string }) {
    return this.licensingService.activateLicense(
      req.user.organizationId,
      body.licenseKey,
    );
  }

  @Post('renew')
  @Roles(UserRole.ADMIN)
  async renew(@Req() req: any, @Body() body: { days?: number }) {
    return this.licensingService.renewLicense(
      req.user.organizationId,
      body.days ?? 30,
    );
  }

  @Post('suspend')
  @Roles(UserRole.ADMIN)
  async suspend(@Req() req: any, @Body() body: { reason?: string }) {
    return this.licensingService.suspendLicense(
      req.user.organizationId,
      body.reason,
    );
  }

  @Post('seats/assign')
  @Roles(UserRole.ADMIN)
  async assignSeat(@Req() req: any) {
    return this.licensingService.assignSeat(req.user.organizationId);
  }

  @Post('seats/revoke')
  @Roles(UserRole.ADMIN)
  async revokeSeat(@Req() req: any) {
    return this.licensingService.revokeSeat(req.user.organizationId);
  }

  @Post('usage/consume')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async consume(@Req() req: any, @Body() body: { amount?: number }) {
    return this.licensingService.consumeMessageQuota(
      req.user.organizationId,
      body.amount ?? 1,
    );
  }

  @Get('features/:feature')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async feature(@Req() req: any, @Param('feature') feature: string) {
    const hasAccess = await this.licensingService.hasFeatureAccess(
      req.user.organizationId,
      feature.toUpperCase(),
    );
    return { feature: feature.toUpperCase(), hasAccess };
  }
}

