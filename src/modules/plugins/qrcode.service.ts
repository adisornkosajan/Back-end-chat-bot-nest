import { Injectable } from '@nestjs/common';

@Injectable()
export class QRCodeService {
  /**
   * สร้าง PromptPay QR Code Payload
   * @param phoneNumber เบอร์โทรศัพท์ (10 หลัก) หรือ Tax ID (13 หลัก)
   * @param amount จำนวนเงิน (optional)
   * @returns QR Code string ตาม EMVCo standard
   */
  generatePromptPayPayload(phoneNumber: string, amount?: number): string {
    // ลบ - และช่องว่างออกจากเบอร์
    const cleanPhone = phoneNumber.replace(/[-\s]/g, '');
    
    // แปลงเบอร์โทรเป็นรูปแบบ PromptPay
    // 0812345678 -> 0066812345678 (เติม 0066 แทน 0)
    const formattedPhone = '0066' + cleanPhone.substring(1);

    // สร้าง Payload ตาม EMVCo standard
    let payload = '';
    
    // Payload Format Indicator
    payload += this.buildTLV('00', '01');
    
    // Point of Initiation Method (Static QR)
    payload += this.buildTLV('01', '11'); // 11 = static, 12 = dynamic
    
    // Merchant Account Information
    let merchantInfo = '';
    merchantInfo += this.buildTLV('00', 'A000000677010111'); // PromptPay AID
    merchantInfo += this.buildTLV('01', formattedPhone); // Phone number
    if (amount) {
      merchantInfo += this.buildTLV('02', '00'); // Bill Payment
    }
    payload += this.buildTLV('29', merchantInfo);
    
    // Transaction Currency (764 = THB)
    payload += this.buildTLV('53', '764');
    
    // Transaction Amount (ถ้ามี)
    if (amount && amount > 0) {
      payload += this.buildTLV('54', amount.toFixed(2));
    }
    
    // Country Code
    payload += this.buildTLV('58', 'TH');
    
    // CRC (คำนวณท้ายสุด)
    payload += '6304';
    const crc = this.calculateCRC16(payload);
    payload += crc;
    
    return payload;
  }

  /**
   * สร้าง TLV (Tag-Length-Value) format
   */
  private buildTLV(tag: string, value: string): string {
    const length = value.length.toString().padStart(2, '0');
    return tag + length + value;
  }

  /**
   * คำนวณ CRC16 CCITT
   */
  private calculateCRC16(payload: string): string {
    let crc = 0xFFFF;
    
    for (let i = 0; i < payload.length; i++) {
      crc ^= payload.charCodeAt(i) << 8;
      
      for (let j = 0; j < 8; j++) {
        if ((crc & 0x8000) !== 0) {
          crc = (crc << 1) ^ 0x1021;
        } else {
          crc = crc << 1;
        }
      }
    }
    
    crc = crc & 0xFFFF;
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  /**
   * สร้าง Data URL สำหรับ QR Code Image
   * ใช้ library qrcode
   */
  async generateQRCodeImage(payload: string): Promise<string> {
    // ต้อง install: npm install qrcode @types/qrcode
    const QRCode = require('qrcode');
    
    try {
      // สร้าง QR Code เป็น Data URL (base64)
      const qrCodeDataUrl = await QRCode.toDataURL(payload, {
        errorCorrectionLevel: 'M',
        type: 'image/png',
        width: 300,
        margin: 1,
      });
      
      return qrCodeDataUrl;
    } catch (error) {
      throw new Error('Failed to generate QR code image');
    }
  }

  /**
   * ตัวอย่างการใช้งาน
   */
  async generatePromptPayQR(phoneNumber: string, amount?: number): Promise<{
    payload: string;
    qrCodeImage: string;
  }> {
    const payload = this.generatePromptPayPayload(phoneNumber, amount);
    const qrCodeImage = await this.generateQRCodeImage(payload);
    
    return {
      payload,
      qrCodeImage, // base64 data URL
    };
  }
}
