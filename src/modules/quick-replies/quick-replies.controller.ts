import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  Query,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { QuickRepliesService } from './quick-replies.service';

@Controller('quick-replies')
@UseGuards(AuthGuard('jwt'))
export class QuickRepliesController {
  constructor(private readonly quickRepliesService: QuickRepliesService) {}

  @Get()
  async list(@Req() req: any) {
    return this.quickRepliesService.list(req.user.organizationId);
  }

  @Get('search')
  async search(@Req() req: any, @Query('q') query: string) {
    return this.quickRepliesService.search(req.user.organizationId, query);
  }

  @Post()
  async create(
    @Req() req: any,
    @Body()
    body: {
      shortcut: string;
      content: string;
      category?: string;
    },
  ) {
    return this.quickRepliesService.create(req.user.organizationId, body);
  }

  @Put(':id')
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      shortcut?: string;
      content?: string;
      category?: string;
      isActive?: boolean;
    },
  ) {
    return this.quickRepliesService.update(req.user.organizationId, id, body);
  }

  @Delete(':id')
  async delete(@Req() req: any, @Param('id') id: string) {
    return this.quickRepliesService.delete(req.user.organizationId, id);
  }
}
