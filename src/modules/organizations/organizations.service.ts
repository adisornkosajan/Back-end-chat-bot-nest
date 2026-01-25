import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    this.logger.debug(`🏢 Finding organization by ID: ${id}`);
    const org = await this.prisma.organization.findUnique({
      where: { id },
    });
    if (org) {
      this.logger.debug(`✅ Organization found: ${org.name}`);
    } else {
      this.logger.debug(`❌ Organization not found: ${id}`);
    }
    return org;
  }
}
