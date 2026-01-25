import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string) {
    this.logger.debug(`🔍 Finding user by email: ${email}`);
    const user = await this.prisma.user.findUnique({
      where: { email },
    });
    if (user) {
      this.logger.debug(`✅ User found: ${user.id}`);
    } else {
      this.logger.debug(`❌ User not found: ${email}`);
    }
    return user;
  }
}
