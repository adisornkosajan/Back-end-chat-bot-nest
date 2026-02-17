const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkWhatsApp() {
  try {
    const platforms = await prisma.platform.findMany({
      where: { type: 'whatsapp' },
      include: {
        organization: {
          select: { name: true }
        }
      }
    });
    
    console.log('=== WhatsApp Platforms ===');
    console.log(JSON.stringify(platforms, null, 2));
    
    if (platforms.length === 0) {
      console.log('\n⚠️ No WhatsApp platforms found!');
    }
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkWhatsApp();
