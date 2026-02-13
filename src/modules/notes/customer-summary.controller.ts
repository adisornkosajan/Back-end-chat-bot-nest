import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CustomerSummaryService } from './customer-summary.service';

@Controller('customer-summaries')
@UseGuards(AuthGuard('jwt'))
export class CustomerSummaryController {
  constructor(private customerSummaryService: CustomerSummaryService) {}

  @Get('conversation/:conversationId')
  async getByConversation(@Req() req: any, @Param('conversationId') conversationId: string) {
    return this.customerSummaryService.findByConversation(
      req.user.organizationId,
      conversationId,
    );
  }

  @Get('conversation/:conversationId/history')
  async getHistory(@Req() req: any, @Param('conversationId') conversationId: string) {
    return this.customerSummaryService.getHistory(
      req.user.organizationId,
      conversationId,
    );
  }

  @Post('conversation/:conversationId')
  async upsertSummary(
    @Req() req: any,
    @Param('conversationId') conversationId: string,
    @Body() body: {
      name?: string;
      mobile?: string;
      email?: string;
      importantKey?: string;
    },
  ) {
    console.log('User from request:', req.user);
    const userId = req.user.id || req.user.sub || req.user.userId;
    console.log('Using userId:', userId);
    
    if (!userId) {
      throw new Error('User ID not found in request');
    }
    
    return this.customerSummaryService.upsert(
      req.user.organizationId,
      conversationId,
      body,
      userId,
    );
  }

  @Post('conversation/:conversationId/generate')
  async generateSummary(
    @Req() req: any,
    @Param('conversationId') conversationId: string,
  ) {
    const userId = req.user.id || req.user.sub || req.user.userId;
    if (!userId) {
      throw new Error('User ID not found in request');
    }

    return this.customerSummaryService.generateFromConversation(
      req.user.organizationId,
      conversationId,
      userId,
    );
  }

  @Delete('conversation/:conversationId')
  async deleteSummary(@Req() req: any, @Param('conversationId') conversationId: string) {
    return this.customerSummaryService.delete(
      req.user.organizationId,
      conversationId,
    );
  }
}
