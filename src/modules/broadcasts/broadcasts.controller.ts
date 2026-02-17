import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
  Patch,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BroadcastsService } from './broadcasts.service';
@Controller('broadcasts')
@UseGuards(AuthGuard('jwt'))
export class BroadcastsController {
  constructor(private readonly broadcastsService: BroadcastsService) {}

  /**
   * GET /api/broadcasts — List all broadcasts
   */
  @Get()
  async list(@Req() req: any) {
    return this.broadcastsService.listBroadcasts(req.user.organizationId);
  }

  /**
   * GET /api/broadcasts/:id — Get broadcast detail
   */
  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    return this.broadcastsService.getBroadcast(req.user.organizationId, id);
  }
  /**
   * PATCH /api/broadcasts/:id — Update broadcast (draft / scheduled)
   */
  @Patch(':id')
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      message?: string;
      imageUrl?: string;
      platformType?: string;
      filterTags?: string[];
      scheduledAt?: string;
      timeZone?: string;
    },
  ) {
    return this.broadcastsService.updateBroadcast(
      req.user.organizationId,
      id,
      body,
    );
  }

  /**
   * POST /api/broadcasts — Create a new broadcast
   */
  @Post()
  async create(
    @Req() req: any,
    @Body()
    body: {
      name: string;
      message: string;
      imageUrl?: string;
      platformType?: string;
      filterTags?: string[];
      scheduledAt?: string;
      timeZone?: string;
    },
  ) {
    const userId = req.user?.id || req.user?.userId || req.user?.sub;
    return this.broadcastsService.createBroadcast(
      req.user.organizationId,
      userId,
      body,
    );
  }

  /**
   * POST /api/broadcasts/:id/send — Send a broadcast
   */
  @Post(':id/send')
  async send(@Req() req: any, @Param('id') id: string) {
    return this.broadcastsService.sendBroadcast(req.user.organizationId, id);
  }

  /**
   * DELETE /api/broadcasts/:id — Delete a draft broadcast
   */
  @Delete(':id')
  async delete(@Req() req: any, @Param('id') id: string) {
    return this.broadcastsService.deleteBroadcast(req.user.organizationId, id);
  }

  @Patch(':id/pause')
  async pause(@Req() req: any, @Param('id') id: string) {
    return this.broadcastsService.pauseBroadcast(req.user.organizationId, id);
  }

  @Patch(':id/resume')
  async resume(@Req() req: any, @Param('id') id: string) {
    return this.broadcastsService.resumeBroadcast(req.user.organizationId, id);
  }
}
