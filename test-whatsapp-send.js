const axios = require('axios');

// Test WhatsApp API Configuration
const config = {
  phoneNumberId: '939524039244168',
  accessToken: 'EAATqwrPkpAcBQptBhdIWcwKCr5XECsZBV8vimnhMxAmQ2jGcPnioTtPfEo8ZB0T1ZBCaaCslTIiShmmXpXyznEiGFgFWZBIyDjndbuiuvkvZCXhMF0qtwZAL6rOhpTSqI6hVKaNPqQetr1SRF4ooRkoWpUJDLR4ggN5mZChah4BhsFhwWY3xdQtGodXvHS445hdGvV5lfDBU0Dwv27urlTHJKhO6KvL5uphUXq0RRYoXZAkn3T2CPzq2ZBZBNVpx1neOXBOmslMF007UCDz1M0rStZBPPCx',
  testPhoneNumber: '', // ใส่เบอร์ทดสอบที่นี่ (เช่น '66812345678')
};

async function testWhatsAppSend() {
  console.log('🧪 Testing WhatsApp API Send...\n');
  
  if (!config.testPhoneNumber) {
    console.log('❌ Please set testPhoneNumber in the config');
    console.log('   Example: testPhoneNumber: "66812345678"');
    return;
  }
  
  try {
    const url = `https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`;
    
    console.log('📤 Sending test message to:', config.testPhoneNumber);
    console.log('📡 API URL:', url);
    console.log('🔑 Using Phone Number ID:', config.phoneNumberId);
    console.log('🎫 Access Token:', config.accessToken.substring(0, 20) + '...\n');
    
    const response = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to: config.testPhoneNumber,
        type: 'text',
        text: {
          body: 'Test message from ChatAI - ' + new Date().toLocaleString()
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        }
      }
    );
    
    console.log('✅ SUCCESS! Message sent');
    console.log('Response:', JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    console.log('❌ FAILED to send message\n');
    
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Error Data:', JSON.stringify(error.response.data, null, 2));
      
      const errorData = error.response.data?.error;
      if (errorData) {
        console.log('\n🔍 Error Analysis:');
        console.log('   Code:', errorData.code);
        console.log('   Message:', errorData.message);
        console.log('   Type:', errorData.type);
        
        // Common error solutions
        if (errorData.code === 190) {
          console.log('\n💡 Solution: Access Token has expired or is invalid');
          console.log('   → Reconnect WhatsApp in the Connections page');
        } else if (errorData.code === 131030 || errorData.code === 131031) {
          console.log('\n💡 Solution: Recipient phone number issue');
          console.log('   → Check the phone number format (include country code)');
          console.log('   → The recipient must have WhatsApp installed');
        } else if (errorData.code === 100) {
          console.log('\n💡 Solution: Invalid parameter or missing permission');
          console.log('   → Check WhatsApp Business API permissions');
        } else if (errorData.code === 80007) {
          console.log('\n💡 Solution: 24-hour messaging window expired');
          console.log('   → Customer must message you first');
          console.log('   → Or use approved message templates');
        }
      }
    } else {
      console.log('Error:', error.message);
    }
  }
}

testWhatsAppSend();
