import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AutoAssignRulesService, RuleConditions } from './auto-assign-rules.service';

@Controller('auto-assign-rules')
@UseGuards(AuthGuard('jwt'))
export class AutoAssignRulesController {
  constructor(private readonly rulesService: AutoAssignRulesService) {}

  /**
   * GET /api/auto-assign-rules — List all rules
   */
  @Get()
  async list(@Req() req: any) {
    return this.rulesService.listRules(req.user.organizationId);
  }

  /**
   * GET /api/auto-assign-rules/:id — Get rule detail
   */
  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    return this.rulesService.getRule(req.user.organizationId, id);
  }

  /**
   * POST /api/auto-assign-rules — Create a new rule
   */
  @Post()
  async create(
    @Req() req: any,
    @Body()
    body: {
      name: string;
      type: string;
      conditions: RuleConditions;
      assignToAgentId?: string;
      priority?: number;
    },
  ) {
    return this.rulesService.createRule(req.user.organizationId, body);
  }

  /**
   * PATCH /api/auto-assign-rules/:id — Update a rule
   */
  @Patch(':id')
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      type?: string;
      conditions?: RuleConditions;
      assignToAgentId?: string | null;
      priority?: number;
      isActive?: boolean;
    },
  ) {
    return this.rulesService.updateRule(req.user.organizationId, id, body);
  }

  /**
   * POST /api/auto-assign-rules/:id/toggle — Toggle active/inactive
   */
  @Post(':id/toggle')
  async toggle(@Req() req: any, @Param('id') id: string) {
    return this.rulesService.toggleRule(req.user.organizationId, id);
  }

  /**
   * DELETE /api/auto-assign-rules/:id — Delete a rule
   */
  @Delete(':id')
  async delete(@Req() req: any, @Param('id') id: string) {
    return this.rulesService.deleteRule(req.user.organizationId, id);
  }
}
