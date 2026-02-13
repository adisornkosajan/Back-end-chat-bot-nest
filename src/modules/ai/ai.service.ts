import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly aiApiUrl: string;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    // ดึง URL ของ AI API จาก environment variable
    this.aiApiUrl = this.configService.get<string>('AI_API_URL') || 'http://localhost:5000/api/chat';
  }

  /**
   * @param message ข้อความจากลูกค้า
   * @param conversationId ID ของ conversation (สำหรับ context)
   * @param customerId ID ของลูกค้า
   * @returns คำตอบจาก AI
   */
  async getAiResponse(
    message: string,
    conversationId: string,
    customerId: string,
  ): Promise<string> {
    try {
      this.logger.log(`🤖 Sending message to AI API: ${message.substring(0, 50)}...`);

      const response = await axios.post(
        this.aiApiUrl,
        {
          message: message,
          conversationId: conversationId,
          customerId: customerId,
          timestamp: new Date().toISOString(),
        },
        {
          timeout: 30000, // 30 วินาที
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      const aiResponse = response.data?.response || response.data?.message || 'Sorry, I cannot respond right now.';
      
      this.logger.log(`✅ AI Response received: ${aiResponse.substring(0, 50)}...`);
      
      return aiResponse;
    } catch (error: any) {
      // Log detailed error information
      if (error.response) {
        // The request was made and the server responded with a status code outside of 2xx
        this.logger.error('❌ AI API Error Response:', {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data,
          url: this.aiApiUrl,
        });
      } else if (error.request) {
        // The request was made but no response was received
        this.logger.error('❌ AI API No Response:', {
          message: error.message,
          code: error.code,
          url: this.aiApiUrl,
          error: 'AI service is not responding. Is it running?',
        });
      } else {
        // Something happened in setting up the request
        this.logger.error('❌ AI API Request Error:', {
          message: error.message,
          stack: error.stack,
        });
      }
      
      // กรณีเกิดข้อผิดพลาด ส่งข้อความสำรองกลับไป
      return 'Sorry, the AI service is temporarily unavailable. Please try again shortly or contact support.';
    }
  }

  /**
   * ตรวจสอบว่า AI API ใช้งานได้หรือไม่
   */
  async healthCheck(): Promise<boolean> {
    try {
      const healthUrl = this.aiApiUrl.replace('/chat', '/health');
      const response = await axios.get(healthUrl, { timeout: 5000 });
      return response.status === 200;
    } catch (error) {
      this.logger.warn('⚠️ AI API health check failed');
      return false;
    }
  }

  /**
   * Get AI configuration for organization
   */
  async getConfig(organizationId: string) {
    this.logger.log(`📝 Getting AI config for organization ${organizationId}`);
    
    let config = await this.prisma.aIConfig.findUnique({
      where: { organizationId },
    });

    // If no config exists, return default
    if (!config) {
      return {
        provider: 'openai',
        model: 'gpt-4',
        temperature: 0.7,
        maxTokens: 1000,
        systemPrompt: 'You are a helpful customer service assistant.',
        isActive: false,
      };
    }

    // Don't return API key for security
    return {
      provider: config.provider,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      systemPrompt: config.systemPrompt,
      isActive: config.isActive,
      hasApiKey: !!config.apiKey,
    };
  }

  /**
   * Save AI configuration for organization
   */
  async saveConfig(
    organizationId: string,
    data: {
      provider: string;
      model?: string;
      apiKey?: string;
      temperature?: number;
      maxTokens?: number;
      systemPrompt?: string;
    },
  ) {
    this.logger.log(`💾 Saving AI config for organization ${organizationId}`);

    const config = await this.prisma.aIConfig.upsert({
      where: { organizationId },
      create: {
        organizationId,
        provider: data.provider,
        model: data.model,
        apiKey: data.apiKey,
        temperature: data.temperature ?? 0.7,
        maxTokens: data.maxTokens ?? 1000,
        systemPrompt: data.systemPrompt,
        isActive: true,
      },
      update: {
        provider: data.provider,
        model: data.model,
        ...(data.apiKey && { apiKey: data.apiKey }), // Only update if provided
        temperature: data.temperature ?? 0.7,
        maxTokens: data.maxTokens ?? 1000,
        systemPrompt: data.systemPrompt,
        isActive: true,
      },
    });

    this.logger.log(`✅ AI config saved for organization ${organizationId}`);

    // Return without API key
    return {
      provider: config.provider,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      systemPrompt: config.systemPrompt,
      isActive: config.isActive,
    };
  }

  /**
   * Test AI connection with provided settings
   */
  async testConnection(data: {
    provider: string;
    model?: string;
    apiKey: string;
  }): Promise<{ success: boolean; message: string }> {
    this.logger.log(`🧪 Testing AI connection with ${data.provider}`);

    try {
      // Test based on provider
      if (data.provider === 'openai') {
        const response = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: data.model || 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: 'Test connection' }],
            max_tokens: 10,
          },
          {
            headers: {
              'Authorization': `Bearer ${data.apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          },
        );

        if (response.status === 200) {
          return { success: true, message: 'Connection successful' };
        }
      } else if (data.provider === 'anthropic') {
        const response = await axios.post(
          'https://api.anthropic.com/v1/messages',
          {
            model: data.model || 'claude-3-opus-20240229',
            messages: [{ role: 'user', content: 'Test connection' }],
            max_tokens: 10,
          },
          {
            headers: {
              'x-api-key': data.apiKey,
              'anthropic-version': '2023-06-01',
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          },
        );

        if (response.status === 200) {
          return { success: true, message: 'Connection successful' };
        }
      } else if (data.provider === 'gemini') {
        const response = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${data.model || 'gemini-pro'}:generateContent?key=${data.apiKey}`,
          {
            contents: [{ parts: [{ text: 'Test connection' }] }],
          },
          {
            headers: {
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          },
        );

        if (response.status === 200) {
          return { success: true, message: 'Connection successful' };
        }
      }

      return { success: false, message: 'Unsupported provider' };
    } catch (error: any) {
      this.logger.error('❌ AI connection test failed:', error.message);
      
      if (error.response?.status === 401) {
        return { success: false, message: 'Invalid API key' };
      }
      
      return { 
        success: false, 
        message: error.response?.data?.error?.message || error.message || 'Connection failed' 
      };
    }
  }
}
