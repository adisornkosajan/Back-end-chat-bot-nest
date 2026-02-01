import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly aiApiUrl: string;

  constructor(private configService: ConfigService) {
    // ดึง URL ของ AI API จาก environment variable
    this.aiApiUrl = this.configService.get<string>('AI_API_URL') || 'http://localhost:5000/api/chat';
  }

  /**
   * ส่งข้อความไปยัง AI API และรับคำตอบกลับ
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

      const aiResponse = response.data?.response || response.data?.message || 'ขออภัยค่ะ ไม่สามารถตอบกลับได้ในขณะนี้';
      
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
      return 'ขออภัยค่ะ ระบบ AI มีปัญหาชั่วคราว กรุณารอสักครู่หรือติดต่อเจ้าหน้าที่ค่ะ';
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
}
