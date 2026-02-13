import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Post,
} from '@nestjs/common';
import { PlatformAdminService } from './platform-admin.service';

@Controller('platform-bootstrap')
export class PlatformBootstrapController {
  constructor(private readonly platformAdminService: PlatformAdminService) {}

  @Post('owner')
  async setInitialOwner(
    @Body() body: { email: string; secret: string },
  ) {
    const expected = process.env.PLATFORM_OWNER_SECRET;
    if (!expected) {
      throw new ForbiddenException('PLATFORM_OWNER_SECRET is not configured');
    }
    if (body.secret !== expected) {
      throw new ForbiddenException('Invalid bootstrap secret');
    }

    return this.platformAdminService.setOwnerByEmail(body.email);
  }

  @Post('super-admin')
  async bootstrapSuperAdmin(
    @Body()
    body: { email: string; password: string; name: string; secret: string },
  ) {
    const expected = process.env.SUPER_ADMIN_BOOTSTRAP_SECRET;
    if (!expected) {
      throw new ForbiddenException('SUPER_ADMIN_BOOTSTRAP_SECRET is not configured');
    }
    if (body.secret !== expected) {
      throw new ForbiddenException('Invalid bootstrap secret');
    }

    if (!body.email || !body.password || !body.name) {
      throw new BadRequestException('email, password, and name are required');
    }

    return this.platformAdminService.bootstrapSuperAdmin({
      email: body.email,
      password: body.password,
      name: body.name,
    });
  }
}
