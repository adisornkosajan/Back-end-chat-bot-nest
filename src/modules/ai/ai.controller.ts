import { Controller, Post, Body, Get, UseGuards } from '@nestjs/common';
import { AiService } from './ai.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * Endpoint สำหรับทดสอบ AI โดยตรง
   */
  @Post('chat')
  @UseGuards(AuthGuard('jwt'))
  async chat(
    @Body() body: { message: string; conversationId?: string; customerId?: string },
  ) {
    const { message, conversationId, customerId } = body;
    
    const response = await this.aiService.getAiResponse(
      message,
      conversationId || 'test',
      customerId || 'test-customer',
    );

    return {
      success: true,
      response,
    };
  }

  /**
   * ตรวจสอบสถานะของ AI API
   */
  @Get('health')
  async health() {
    const isHealthy = await this.aiService.healthCheck();
    return {
      success: isHealthy,
      status: isHealthy ? 'healthy' : 'unhealthy',
    };
  }
}
