import { INestApplication, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient
  implements OnModuleInit
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    this.logger.log('🗄️  Connecting to database...');
    await this.$connect();
    this.logger.log('✅ Database connected successfully');
  }

  async enableShutdownHooks(app: INestApplication) {
    this.logger.log('🔌 Setting up shutdown hooks');
    // @ts-ignore - Prisma v5 typing issue
    this.$on('beforeExit', async () => {
      this.logger.log('👋 Closing application...');
      await app.close();
    });
  }
}
