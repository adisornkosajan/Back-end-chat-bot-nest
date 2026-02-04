import {
  Controller,
  Post,
  Put,
  Get,
  Body,
  Param,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AssignmentService } from './assignment.service';
import { ConversationStatus } from '@prisma/client';

@Controller('conversations')
@UseGuards(AuthGuard('jwt'))
export class AssignmentController {
  constructor(private readonly assignmentService: AssignmentService) {}

  @Post(':id/assign')
  async assign(
    @Req() req: any,
    @Param('id') conversationId: string,
    @Body() body: { agentId: string },
  ) {
    if (!body.agentId) {
      throw new BadRequestException('agentId is required');
    }

    return this.assignmentService.assignConversation(
      conversationId,
      body.agentId,
      req.user.organizationId,
    );
  }

  @Post(':id/unassign')
  async unassign(@Req() req: any, @Param('id') conversationId: string) {
    return this.assignmentService.unassignConversation(
      conversationId,
      req.user.organizationId,
    );
  }

  @Put(':id/status')
  async changeStatus(
    @Req() req: any,
    @Param('id') conversationId: string,
    @Body() body: { status: ConversationStatus },
  ) {
    if (!body.status) {
      throw new BadRequestException('status is required');
    }

    // Validate status
    const validStatuses = Object.values(ConversationStatus);
    if (!validStatuses.includes(body.status)) {
      throw new BadRequestException(
        `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      );
    }

    return this.assignmentService.changeStatus(
      conversationId,
      body.status,
      req.user.organizationId,
    );
  }

  @Get('unassigned')
  async getUnassigned(@Req() req: any) {
    return this.assignmentService.getUnassigned(req.user.organizationId);
  }

  @Post('auto-assign')
  async autoAssign(@Req() req: any) {
    return this.assignmentService.autoAssign(req.user.organizationId);
  }

  @Post(':id/transfer')
  async transfer(
    @Req() req: any,
    @Param('id') conversationId: string,
    @Body() body: { toAgentId: string },
  ) {
    if (!body.toAgentId) {
      throw new BadRequestException('toAgentId is required');
    }

    return this.assignmentService.transferConversation(
      conversationId,
      req.user.id,
      body.toAgentId,
      req.user.organizationId,
    );
  }

  @Get('my-conversations')
  async getMyConversations(@Req() req: any) {
    return this.assignmentService.getAgentConversations(
      req.user.id,
      req.user.organizationId,
    );
  }
}
