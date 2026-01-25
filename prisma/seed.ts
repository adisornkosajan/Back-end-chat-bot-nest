import { PrismaClient, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // 1. สร้าง Organization
  const org = await prisma.organization.upsert({
    where: { id: '7d5ccf89-f908-11f0-a5db-66a7c93ca4bc' },
    update: {},
    create: {
      id: '7d5ccf89-f908-11f0-a5db-66a7c93ca4bc',
      name: 'Demo Organization',
    },
  });
  console.log('✅ Organization created:', org.name);

  // 2. สร้าง User
  const passwordHash = await bcrypt.hash('password123', 10);
  const user = await prisma.user.upsert({
    where: { email: 'admin@demo.com' },
    update: {},
    create: {
      id: '84f4f873-f908-11f0-a5db-66a7c93ca4bc',
      email: 'admin@demo.com',
      passwordHash: passwordHash,
      name: 'Admin User',
      organizationId: org.id,
      role: 'owner',
    },
  });
  console.log('✅ User created:', user.email);
  console.log('   Password: password123');

  // 3. สร้าง Platform (Facebook)
  const platform = await prisma.platform.create({
    data: {
      id: 'b08ef7e9-f908-11f0-a5db-66a7c93ca4bc',
      organizationId: org.id,
      type: 'facebook',
      pageId: 'YOUR_PAGE_ID',
      accessToken: 'YOUR_FACEBOOK_PAGE_TOKEN',
      isActive: true,
    },
  });
  console.log('✅ Platform created:', platform.type);

  // 4. สร้าง Customer ตัวอย่าง
  const customer = await prisma.customer.upsert({
    where: {
      platformId_externalId: {
        platformId: platform.id,
        externalId: 'fb_user_001',
      },
    },
    update: {},
    create: {
      id: 'c6b4a4d0-9e47-4a53-8ab6-952e98045145',
      organizationId: org.id,
      platformId: platform.id,
      externalId: 'fb_user_001',
      name: 'Demo Customer',
    },
  });
  console.log('✅ Customer created:', customer.name);

  // 5. สร้าง Conversation
  const conversation = await prisma.conversation.upsert({
    where: {
      platformId_customerId: {
        platformId: platform.id,
        customerId: customer.id,
      },
    },
    update: {},
    create: {
      id: 'c8dd9e2f-6ebc-4997-9e33-0807f8f08729',
      organizationId: org.id,
      platformId: platform.id,
      customerId: customer.id,
      status: 'open',
    },
  });
  console.log('✅ Conversation created');

  console.log('\n🎉 Seeding completed!');
  console.log('\n📋 Summary:');
  console.log(`   Organization: ${org.name}`);
  console.log(`   User: ${user.email} (password: password123)`);
  console.log(`   Platform: ${platform.type}`);
  console.log(`   Customer: ${customer.name}`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
