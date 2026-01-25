# คู่มือตั้งค่า Meta App สำหรับ WhatsApp, Instagram และ Facebook

## 🚨 สำคัญที่สุด: WhatsApp Business API

### ขั้นตอนที่ 1: เตรียมความพร้อม WhatsApp

**1.1 ต้องมี Meta Business Account**
- ไปที่: https://business.facebook.com/
- สร้าง Business Manager ถ้ายังไม่มี
- ต้องยืนยันตัวตน (Business Verification) สำหรับ WhatsApp

**1.2 ความต้องการของ WhatsApp Business API:**
- ❌ **ไม่ใช่** WhatsApp Business App (สีเขียว) ที่ใช้ทั่วไป
- ✅ ต้องเป็น **WhatsApp Business Platform/API**
- ต้องมีเบอร์โทรศัพท์ที่ยังไม่เคยใช้กับ WhatsApp
- ต้องผ่าน Business Verification (ใช้เวลา 1-3 สัปดาห์)

---

## 📱 ขั้นตอนการตั้งค่า Meta App

### Step 1: สร้าง Meta App

1. ไปที่: https://developers.facebook.com/apps
2. คลิก **"Create App"**
3. เลือก App Type: **"Business"**
4. ตั้งชื่อ App: เช่น "OmniChat SaaS"
5. เลือก Business Account ของคุณ

---

### Step 2: เพิ่ม Products

#### 2.1 เพิ่ม WhatsApp (สำคัญที่สุด!)

1. ใน Dashboard คลิก **"Add Product"**
2. เลือก **"WhatsApp"**
3. คลิก **"Set Up"**

**ตั้งค่า WhatsApp:**

**A. เลือก Business Portfolio**
- เลือก Business Account ที่ต้องการ
- คลิก Continue

**B. สร้าง/เลือก WhatsApp Business Account**
- คลิก **"Create new WhatsApp Business Account"**
- ตั้งชื่อ: เช่น "OmniChat Business"
- เลือก Timezone

**C. เพิ่มเบอร์โทรศัพท์**
- คลิก **"Add phone number"**
- กรอกเบอร์โทร (ต้องไม่เคยใช้กับ WhatsApp มาก่อน)
- เลือกวิธียืนยัน: SMS หรือ Voice call
- กรอกรหัส 6 หลัก

**D. Business Verification (บังคับ)**
```
⚠️ WhatsApp ต้อง verify business ก่อนใช้งาน production
```
- ไปที่: https://business.facebook.com/settings/security
- คลิก **"Start verification"**
- อัปโหลดเอกสาร:
  - ใบทะเบียนบริษัท/ห้างหุ้นส่วน
  - หรือบัตรประชาชน + หนังสือรับรองบริษัท
  - หรือ Business license
- รอ 1-7 วัน (บางทีถึง 3 สัปดาห์)

**E. ตั้งค่า Display Name และ Profile**
- WhatsApp Settings → Profile
- Display name: ชื่อที่จะแสดงให้ลูกค้าเห็น
- About: คำอธิบายธุรกิจ
- Profile picture: โลโก้
- Category: ประเภทธุรกิจ

---

#### 2.2 เพิ่ม Facebook Login

1. คลิก **"Add Product"** → เลือก **"Facebook Login"**
2. เลือก Platform: **"Web"**
3. ข้าม Quick Start

**ตั้งค่า Facebook Login:**
- ไปที่: Settings → Basic
- Valid OAuth Redirect URIs:
```
https://june-mammary-abigail.ngrok-free.dev/api/auth/oauth/callback
http://localhost:3001/api/auth/oauth/callback
```

---

#### 2.3 เพิ่ม Messenger

1. คลิก **"Add Product"** → **"Messenger"**
2. คลิก **"Set Up"**

**ตั้งค่า Messenger:**
- เลือก Facebook Page ที่ต้องการ
- Generate Page Access Token

---

### Step 3: ตั้งค่า Webhooks (สำคัญมาก!)

#### 3.1 WhatsApp Webhooks

1. ไปที่: WhatsApp → Configuration
2. คลิก **"Edit"** ที่ Webhook

**ตั้งค่า:**
```
Callback URL: https://june-mammary-abigail.ngrok-free.dev/api/webhooks/whatsapp
Verify Token: your_secure_token_here (ตามใน .env)
```

3. คลิก **"Verify and Save"**
4. Subscribe to webhook fields:
   - ✅ messages
   - ✅ message_status

#### 3.2 Messenger Webhooks

1. ไปที่: Messenger → Settings → Webhooks
2. คลิก **"Add Callback URL"**

```
Callback URL: https://june-mammary-abigail.ngrok-free.dev/api/webhooks/facebook
Verify Token: your_secure_token_here
```

3. Subscribe to:
   - ✅ messages
   - ✅ messaging_postbacks
   - ✅ messaging_optins

#### 3.3 Instagram Webhooks

1. ไปที่: Instagram → Configuration
2. คลิก **"Add Callback URL"**

```
Callback URL: https://june-mammary-abigail.ngrok-free.dev/api/webhooks/instagram
Verify Token: your_secure_token_here
```

3. Subscribe to:
   - ✅ messages
   - ✅ messaging_postbacks
   - ✅ comments (optional)

---

### Step 4: เชื่อม Instagram กับ Facebook Page

**ทำไม Instagram ไม่แสดง?**
→ เพราะ Facebook Page ต้องเชื่อมกับ Instagram Business Account ก่อน

**วิธีเชื่อม Instagram:**

1. **เปลี่ยน Instagram เป็น Business Account:**
   - เปิด Instagram App บนมือถือ
   - Settings → Account → Switch to Professional Account
   - เลือก Business

2. **เชื่อมกับ Facebook Page:**
   - Instagram → Settings → Business
   - Connect to Facebook Page
   - เลือก Facebook Page ที่ต้องการ

3. **ยืนยันการเชื่อมต่อใน Facebook:**
   - ไปที่: https://www.facebook.com/settings?tab=business_tools
   - Instagram Accounts → ดู Instagram ที่เชื่อมอยู่

4. **เปิดใช้ Instagram Messaging:**
   - Instagram App → Settings → Privacy → Messages
   - เปิด "Allow message requests from everyone"

---

### Step 5: ตั้งค่า App Settings

#### 5.1 Basic Settings

```
App ID: xxx (copy ใส่ใน .env)
App Secret: xxx (copy ใส่ใน .env)
App Domains: june-mammary-abigail.ngrok-free.dev
Privacy Policy URL: https://yourdomain.com/privacy
Terms of Service URL: https://yourdomain.com/terms
```

#### 5.2 App Review (สำคัญ!)

**Permissions ที่ต้อง Review:**
- `pages_messaging`
- `instagram_manage_messages`
- `whatsapp_business_messaging`
- `whatsapp_business_management`

**วิธีขอ Review:**
1. ไปที่: App Review → Permissions and Features
2. คลิก **"Request Advanced Access"**
3. กรอกข้อมูล:
   - Detailed Description: อธิบายว่าใช้ทำอะไร
   - Platform Screencast: วิดีโอสาธิต (บังคับ)
   - Privacy Policy URL
   - Terms of Service URL

⚠️ **ก่อน Submit Review:**
- ต้อง verify business
- ต้องมี Privacy Policy และ Terms
- ต้องมีวิดีโอสาธิตการใช้งาน

---

### Step 6: Mode Development vs Live

**Development Mode:**
- ใช้งานได้เฉพาะ Admin, Developer, Tester
- เพิ่ม Test Users ได้ที่: Roles → Test Users

**Live Mode:**
- ต้องผ่าน App Review
- ใช้งานได้กับทุกคน
- สลับที่: App Settings → Switch to Live Mode

---

## 🔧 ไฟล์ .env ที่ต้องตั้งค่า

```env
# Meta App
META_APP_ID=your_app_id
META_APP_SECRET=your_app_secret
META_REDIRECT_URI=https://june-mammary-abigail.ngrok-free.dev/api/auth/oauth/callback
META_WEBHOOK_VERIFY_TOKEN=your_secure_random_token

# WhatsApp (จาก WhatsApp Manager)
WHATSAPP_BUSINESS_ACCOUNT_ID=xxx
WHATSAPP_PHONE_NUMBER_ID=xxx
WHATSAPP_ACCESS_TOKEN=xxx

# Database
DATABASE_URL="mysql://user:password@localhost:3306/omnichat"

# Server
PORT=3001
CORS_ORIGIN=http://localhost:3000
```

---

## 🧪 ทดสอบการทำงาน

### Test WhatsApp

1. ใน WhatsApp Manager → API Setup
2. คลิก **"Send test message"**
3. กรอกเบอร์โทรศัพท์ของคุณ (ต้องอยู่ใน test users)
4. กดส่ง
5. ตรวจสอบว่าได้รับข้อความไหม

### Test Webhooks

1. เปิด ngrok Web Interface: http://127.0.0.1:4040
2. ส่งข้อความไปยัง:
   - Facebook Page
   - Instagram Account
   - WhatsApp Number
3. ดูว่า webhook ได้รับ request ไหม

---

## 🚨 ปัญหาที่พบบ่อย

### WhatsApp ไม่เชื่อม
- ✅ ตรวจสอบว่า verify business แล้วหรือยัง
- ✅ ตรวจสอบเบอร์โทรไม่เคยใช้กับ WhatsApp มาก่อน
- ✅ ตรวจสอบว่า webhook verify สำเร็จ

### Instagram ไม่แสดง
- ✅ เปลี่ยน Instagram เป็น Business Account
- ✅ เชื่อมกับ Facebook Page
- ✅ เปิดใช้ Direct Messages

### Webhooks ไม่ทำงาน
- ✅ ตรวจสอบ ngrok ยังรันอยู่ไหม
- ✅ ตรวจสอบ verify token ตรงกันไหม
- ✅ ตรวจสอบ subscribe to webhook fields ครบไหม

---

## 📚 Links ที่สำคัญ

- Meta Developer Console: https://developers.facebook.com/apps
- Business Manager: https://business.facebook.com/
- WhatsApp Manager: https://business.facebook.com/wa/manage/
- Instagram Business: https://www.facebook.com/business/instagram
- App Review Status: https://developers.facebook.com/apps/{app-id}/app-review/

---

## 💡 เคล็ดลับ

1. **ใช้ ngrok paid plan** ($8/เดือน) → URL ไม่เปลี่ยน
2. **เพิ่ม Test Users** ใน App → ทดสอบก่อน live
3. **เก็บ Access Tokens ปลอดภัย** → ใช้ environment variables
4. **Monitor Webhooks** → ใช้ ngrok inspector (localhost:4040)
5. **Backup Tokens** → Page tokens ไม่หมดอายุถ้าไม่เปลี่ยน permissions

---

## ⏭️ ลำดับที่แนะนำ

1. ✅ สร้าง Meta App
2. ✅ เพิ่ม WhatsApp Product (สำคัญที่สุด)
3. ✅ เพิ่มเบอร์โทร และ verify
4. ✅ ตั้งค่า Webhooks
5. ✅ เพิ่ม Messenger และ Instagram
6. ✅ เชื่อม Instagram กับ Facebook Page
7. ✅ ทดสอบส่ง/รับข้อความ
8. ⏳ รอ Business Verification (1-3 สัปดาห์)
9. ⏳ ขอ App Review สำหรับ permissions
10. 🎉 Launch!
