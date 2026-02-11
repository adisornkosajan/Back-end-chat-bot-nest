import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PlanTier, PlatformRole } from '@prisma/client';
import {
  PlatformRoleName,
  PlatformRoles,
} from '../../common/decorators/platform-roles.decorator';
import { PlatformRolesGuard } from '../../common/guards/platform-roles.guard';
import { PlatformAdminService } from './platform-admin.service';

@Controller('platform-admin')
@UseGuards(AuthGuard('jwt'), PlatformRolesGuard)
@PlatformRoles(PlatformRoleName.OWNER, PlatformRoleName.SUPPORT_ADMIN)
export class PlatformAdminController {
  constructor(private readonly platformAdminService: PlatformAdminService) {}

  @Get('organizations')
  async listOrganizations() {
    return this.platformAdminService.listOrganizations();
  }

  @Get('organizations/:id')
  async getOrganization(@Param('id') organizationId: string) {
    return this.platformAdminService.getOrganizationDetail(organizationId);
  }

  @Post('organizations/:id/plan')
  @PlatformRoles(PlatformRoleName.OWNER)
  async setPlan(
    @Req() req: any,
    @Param('id') organizationId: string,
    @Body() body: { plan: PlanTier; seats?: number; days?: number },
  ) {
    return this.platformAdminService.setOrganizationPlan(
      organizationId,
      body,
      req.user.id,
    );
  }

  @Post('organizations/:id/suspend')
  @PlatformRoles(PlatformRoleName.OWNER)
  async suspendOrg(
    @Param('id') organizationId: string,
    @Body() body: { reason?: string },
  ) {
    return this.platformAdminService.suspendOrganization(
      organizationId,
      body.reason,
    );
  }

  @Post('users/:id/platform-role')
  @PlatformRoles(PlatformRoleName.OWNER)
  async setUserPlatformRole(
    @Param('id') userId: string,
    @Body() body: { platformRole: PlatformRole },
  ) {
    return this.platformAdminService.setUserPlatformRole(
      userId,
      body.platformRole,
    );
  }

  @Post('organizations/:id/impersonate')
  async impersonateOrganization(
    @Req() req: any,
    @Param('id') organizationId: string,
    @Body()
    body?: {
      reason?: string;
      asUserId?: string;
      expiresInMinutes?: number;
    },
  ) {
    return this.platformAdminService.createImpersonationToken(
      req.user,
      organizationId,
      req.headers['user-agent'],
      req.ip,
      body,
    );
  }
}
