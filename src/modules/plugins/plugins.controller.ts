import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PluginsService } from './plugins.service';
import { PluginEngineService } from './plugin-engine.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles, UserRole } from '../../common/decorators/roles.decorator';

@Controller('plugins')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class PluginsController {
  constructor(
    private pluginsService: PluginsService,
    private pluginEngine: PluginEngineService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN)
  async findAll(@Req() req: any) {
    return this.pluginsService.findAll(req.user.organizationId);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  async findOne(@Req() req: any, @Param('id') id: string) {
    return this.pluginsService.findOne(id, req.user.organizationId);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  async create(
    @Req() req: any,
    @Body()
    body: {
      name: string;
      type: string;
      description?: string;
      apiKey?: string;
      apiSecret?: string;
      config?: any;
    }
  ) {
    return this.pluginsService.create(
      req.user.organizationId,
      req.user.id,
      body
    );
  }

  @Put(':id')
  @Roles(UserRole.ADMIN)
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      type?: string;
      description?: string;
      apiKey?: string;
      apiSecret?: string;
      config?: any;
      isActive?: boolean;
    }
  ) {
    return this.pluginsService.update(id, req.user.organizationId, body);
  }

  @Put(':id/toggle')
  @Roles(UserRole.ADMIN)
  async toggleActive(@Req() req: any, @Param('id') id: string) {
    return this.pluginsService.toggleActive(id, req.user.organizationId);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async delete(@Req() req: any, @Param('id') id: string) {
    return this.pluginsService.delete(id, req.user.organizationId);
  }

  /**
   * ดู default config ตัวอย่างสำหรับแต่ละ plugin type
   */
  @Get('templates/:type')
  @Roles(UserRole.ADMIN)
  async getTemplate(@Param('type') type: string) {
    switch (type) {
      case 'auto-reply':
        return {
          type: 'auto-reply',
          name: 'Auto-Reply Plugin',
          description: 'ตอบกลับอัตโนมัติตามคำสำคัญที่กำหนด',
          config: this.pluginEngine.getAutoReplyDefaultConfig(),
        };
      case 'business-hours':
        return {
          type: 'business-hours',
          name: 'Business Hours Plugin',
          description: 'ตรวจสอบเวลาทำการและแจ้งเตือนลูกค้า',
          config: this.pluginEngine.getBusinessHoursDefaultConfig(),
        };
      case 'welcome-message':
        return {
          type: 'welcome-message',
          name: 'Welcome Message Plugin',
          description: 'ส่งข้อความต้อนรับลูกค้าใหม่',
          config: this.pluginEngine.getWelcomeMessageDefaultConfig(),
        };
      default:
        return { error: 'Unknown plugin type' };
    }
  }
}
