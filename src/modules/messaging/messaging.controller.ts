import {
  Controller,
  Get,
  Param,
  UseGuards,
  Req,
  Post,
  Body,
} from '@nestjs/common';
import { MessagingService } from './messaging.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('conversations')
@UseGuards(AuthGuard('jwt'))
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}
  @Post(':id/assign')
  async assign(@Req() req: any, @Param('id') id: string) {
    return this.messaging.assignConversation(
      req.user.organizationId,
      req.user.id,
      id,
    );
  }

  @Get()
  async list(@Req() req: any) {
    return this.messaging.getConversations(req.user.organizationId);
  }

  @Get(':id/messages')
  async messages(@Req() req: any, @Param('id') id: string) {
    return this.messaging.getMessages(req.user.organizationId, id);
  }

  @Post('send')
  async send(
    @Req() req: any,
    @Body() body: { conversationId: string; content: string; agentId: any },
  ) {
    const { conversationId, content,agentId } = body;
    console.log('Sending message to conversation:', conversationId);
    return this.messaging.sendAgentMessage(
      req.user.organizationId,
      conversationId,
      content,
      agentId
    );
  }

  @Post('sync/facebook/:platformId')
  async syncFacebook(@Req() req: any, @Param('platformId') platformId: string) {
    return this.messaging.syncFacebookMessages(
      req.user.organizationId,
      platformId,
    );
  }
}
