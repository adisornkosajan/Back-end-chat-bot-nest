import { Controller, Get, Post, Param, Delete, Put, Body, UseGuards, Req, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PlatformsService } from './platforms.service';

@Controller('platforms')
@UseGuards(AuthGuard('jwt'))
export class PlatformsController {
  private readonly logger = new Logger(PlatformsController.name);

  constructor(private readonly platformsService: PlatformsService) {}

  @Get()
  async list(@Req() req: any) {
    this.logger.log(`📋 Listing platforms for org: ${req.user.organizationId}`);
    return this.platformsService.findAll(req.user.organizationId);
  }

  @Get(':id')
  async getOne(@Req() req: any, @Param('id') id: string) {
    this.logger.log(`🔍 Getting platform: ${id}`);
    return this.platformsService.findOne(req.user.organizationId, id);
  }

  @Put(':id')
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() data: { displayName?: string; credentials?: any },
  ) {
    this.logger.log(`✏️ Updating platform: ${id}`);
    return this.platformsService.update(req.user.organizationId, id, data);
  }

  @Delete(':id')
  async disconnect(@Req() req: any, @Param('id') id: string) {
    this.logger.log(`🔌 Disconnecting platform: ${id}`);
    return this.platformsService.disconnect(req.user.organizationId, id);
  }
}
