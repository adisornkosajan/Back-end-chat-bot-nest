#!/usr/bin/env node

/**
 * WhatsApp Quick Diagnostic Tool
 * ตรวจสอบ configuration และทดสอบการส่งข้อความอย่างรวดเร็ว
 */

const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const readline = require('readline');

const prisma = new PrismaClient();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  console.log('\n🔍 WhatsApp Diagnostic Tool\n');
  console.log('==================================================');
  
  try {
    // 1. Check database configuration
    console.log('\n[1/4] ตรวจสอบ WhatsApp configuration ในฐานข้อมูล...\n');
    
    const platforms = await prisma.platform.findMany({
      where: { type: 'whatsapp', isActive: true },
      include: {
        organization: { select: { name: true } }
      }
    });
    
    if (platforms.length === 0) {
      console.log('❌ ไม่พบ WhatsApp platform ในฐานข้อมูล');
      console.log('   → ต้อง connect WhatsApp ในหน้า Connections ก่อน\n');
      return;
    }
    
    console.log(`✅ พบ ${platforms.length} WhatsApp platform(s):\n`);
    
    platforms.forEach((platform, index) => {
      console.log(`   Platform ${index + 1}:`);
      console.log(`   - Organization: ${platform.organization.name}`);
      console.log(`   - Phone Number ID: ${platform.pageId}`);
      console.log(`   - Display Number: ${platform.credentials?.displayPhoneNumber || 'N/A'}`);
      console.log(`   - Verified Name: ${platform.credentials?.verifiedName || 'N/A'}`);
      console.log(`   - Quality Rating: ${platform.credentials?.qualityRating || 'N/A'}`);
      console.log(`   - Token Length: ${platform.accessToken?.length || 0} chars`);
      console.log('');
    });
    
    // 2. Select platform to test
    let selectedPlatform;
    if (platforms.length === 1) {
      selectedPlatform = platforms[0];
    } else {
      const choice = await askQuestion(`เลือก platform ที่จะทดสอบ (1-${platforms.length}): `);
      selectedPlatform = platforms[parseInt(choice) - 1];
      if (!selectedPlatform) {
        console.log('❌ เลือก platform ไม่ถูกต้อง');
        return;
      }
    }
    
    console.log(`\n[2/4] ทดสอบ Access Token...`);
    
    // 3. Test access token by getting account info
    try {
      const response = await axios.get(
        `https://graph.facebook.com/v21.0/${selectedPlatform.pageId}`,
        {
          params: {
            access_token: selectedPlatform.accessToken,
            fields: 'verified_name,code_verification_status,display_phone_number,quality_rating'
          }
        }
      );
      
      console.log('✅ Access Token ใช้งานได้\n');
      console.log('   Account Info:');
      console.log(`   - Verified Name: ${response.data.verified_name}`);
      console.log(`   - Display Number: ${response.data.display_phone_number}`);
      console.log(`   - Quality Rating: ${response.data.quality_rating}`);
      console.log('');
      
    } catch (error) {
      console.log('❌ Access Token ใช้งานไม่ได้\n');
      if (error.response?.data?.error) {
        console.log(`   Error: ${error.response.data.error.message}`);
        console.log(`   Code: ${error.response.data.error.code}`);
      }
      console.log('\n   → ต้อง reconnect WhatsApp ในหน้า Connections\n');
      return;
    }
    
    // 4. Ask if user wants to send test message
    console.log('[3/4] ทดสอบการส่งข้อความ\n');
    const wantTest = await askQuestion('ต้องการส่งข้อความทดสอบหรือไม่? (y/n): ');
    
    if (wantTest.toLowerCase() !== 'y') {
      console.log('\n✅ การตรวจสอบเสร็จสิ้น - ทุกอย่างพร้อมใช้งาน!\n');
      return;
    }
    
    const phoneNumber = await askQuestion('ใส่เบอร์โทรทดสอบ (เช่น 66812345678): ');
    
    if (!phoneNumber || phoneNumber.length < 10) {
      console.log('❌ เบอร์โทรไม่ถูกต้อง');
      return;
    }
    
    console.log(`\n[4/4] กำลังส่งข้อความไปที่ ${phoneNumber}...\n`);
    
    try {
      const response = await axios.post(
        `https://graph.facebook.com/v21.0/${selectedPlatform.pageId}/messages`,
        {
          messaging_product: 'whatsapp',
          to: phoneNumber,
          type: 'text',
          text: {
            body: `🎉 ทดสอบสำเร็จ! ข้อความจาก ${selectedPlatform.credentials?.verifiedName || 'ChatAI'} เวลา ${new Date().toLocaleString('th-TH')}`
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${selectedPlatform.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log('✅ ส่งข้อความสำเร็จ!\n');
      console.log('   Response:');
      console.log(`   - Message ID: ${response.data.messages?.[0]?.id || 'N/A'}`);
      console.log(`   - Status: ${response.data.messages?.[0]?.message_status || 'sent'}`);
      console.log('');
      console.log('🎊 WhatsApp ทำงานปกติ!\n');
      
    } catch (error) {
      console.log('❌ ส่งข้อความไม่สำเร็จ\n');
      
      if (error.response?.data?.error) {
        const waError = error.response.data.error;
        console.log(`   Error Code: ${waError.code}`);
        console.log(`   Error Message: ${waError.message}`);
        console.log('');
        
        // Provide solutions
        switch (waError.code) {
          case 190:
            console.log('   💡 วิธีแก้: Access Token หมดอายุ → reconnect WhatsApp');
            break;
          case 131030:
          case 131031:
            console.log('   💡 วิธีแก้: เบอร์โทรไม่ถูกต้อง');
            console.log('      - ตรวจสอบ format (ต้องมี country code)');
            console.log('      - ต้องมี WhatsApp ติดตั้งอยู่');
            break;
          case 80007:
            console.log('   💡 วิธีแก้: หมดเวลา 24 ชั่วโมง');
            console.log('      - ให้ลูกค้าส่งข้อความมาก่อน');
            console.log('      - หรือใช้ message template');
            break;
          case 100:
            console.log('   💡 วิธีแก้: Parameter ผิดหรือไม่มี permission');
            console.log('      - ตรวจสอบ WhatsApp Business API setup');
            break;
          default:
            console.log('   💡 วิธีแก้: ดู error message และ code ด้านบน');
            console.log('      - https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes');
        }
        console.log('');
      } else {
        console.log(`   Error: ${error.message}\n`);
      }
    }
    
  } catch (error) {
    console.error('\n❌ เกิดข้อผิดพลาด:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
    rl.close();
  }
}

main().catch(console.error);
