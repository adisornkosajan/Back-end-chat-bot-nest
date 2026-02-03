import { Controller, Post, Body, Get, UseGuards, Put, Req } from '@nestjs/common';
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

  /**
   * Get AI configuration for organization
   */
  @Get('config')
  @UseGuards(AuthGuard('jwt'))
  async getConfig(@Req() req) {
    const organizationId = req.user.organizationId;
    const config = await this.aiService.getConfig(organizationId);
    return {
      success: true,
      data: config,
    };
  }

  /**
   * Save AI configuration for organization
   */
  @Post('config')
  @UseGuards(AuthGuard('jwt'))
  async saveConfig(
    @Req() req,
    @Body() body: {
      provider: string;
      model?: string;
      apiKey?: string;
      temperature?: number;
      maxTokens?: number;
      systemPrompt?: string;
    },
  ) {
    const organizationId = req.user.organizationId;
    const config = await this.aiService.saveConfig(organizationId, body);
    return {
      success: true,
      data: config,
    };
  }

  /**
   * Test AI connection with provided settings
   */
  @Post('test')
  @UseGuards(AuthGuard('jwt'))
  async testConnection(
    @Body() body: {
      provider: string;
      model?: string;
      apiKey: string;
    },
  ) {
    const result = await this.aiService.testConnection(body);
    return {
      success: result.success,
      message: result.message,
    };
  }
}
