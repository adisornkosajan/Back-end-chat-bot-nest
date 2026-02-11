import {
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
}

