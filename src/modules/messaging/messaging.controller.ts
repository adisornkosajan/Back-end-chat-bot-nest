import {
  Controller,
  Get,
  Param,
  UseGuards,
  Req,
  Post,
  Body,
  Query,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MessagingService } from './messaging.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('conversations')
@UseGuards(AuthGuard('jwt'))
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}
  @Post(':id/assign')
  async assign(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { agentId: string | null },
  ) {
    const agentId = body.agentId || req.user.id; // ถ้าไม่ส่ง agentId มาให้ assign ให้ตัวเอง
    return this.messaging.assignConversation(
      req.user.organizationId,
      agentId,
      id,
    );
  }

  @Post(':id/resume-ai')
  async resumeAI(
    @Req() req: any,
    @Param('id') id: string,
  ) {
    return this.messaging.resumeAI(req.user.organizationId, id);
  }

  @Get()
  async list(
    @Req() req: any,
    @Query('assignedTo') assignedTo?: string,
    @Query('status') status?: string,
  ) {
    return this.messaging.getConversations(
      req.user.organizationId,
      assignedTo,
      status,
    );
  }

  @Get(':id/messages')
  async messages(@Req() req: any, @Param('id') id: string) {
    return this.messaging.getMessages(req.user.organizationId, id);
  }

  @Post('send')
  @UseInterceptors(FileInterceptor('image'))
  async send(
    @Req() req: any,
    @Body() body: { conversationId: string; content: string; agentId: any },
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const { conversationId, content } = body;
    const agentId = body.agentId || req.user?.id || req.user?.userId || req.user?.sub;
    console.log('Sending message to conversation:', conversationId);
    console.log('File uploaded:', file ? file.originalname : 'No file');
    return this.messaging.sendAgentMessage(
      req.user.organizationId,
      conversationId,
      content,
      agentId,
      file,
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
