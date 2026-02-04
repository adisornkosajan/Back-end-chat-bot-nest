import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CustomerSummaryService {
  constructor(private prisma: PrismaService) {}

  async findByConversation(organizationId: string, conversationId: string) {
    return this.prisma.customerSummary.findFirst({
      where: {
        organizationId,
        conversationId,
      },
    });
  }

  async upsert(
    organizationId: string,
    conversationId: string,
    data: {
      name?: string;
      mobile?: string;
      email?: string;
      importantKey?: string;
    },
    userId: string,
  ) {
    // Note: userId is optional, will be undefined if not available
    
    // Check if summary already exists
    const existing = await this.prisma.customerSummary.findFirst({
      where: {
        organizationId,
        conversationId,
      },
    });

    if (existing) {
      // Update existing summary
      return this.prisma.customerSummary.update({
        where: { id: existing.id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    } else {
      // Create new summary
      const createData: any = {
        organizationId,
        conversationId,
        ...data,
      };
      
      if (userId) {
        createData.createdBy = userId;
      }
      
      return this.prisma.customerSummary.create({
        data: createData,
      });
    }
  }

  async delete(organizationId: string, conversationId: string) {
    const summary = await this.prisma.customerSummary.findFirst({
      where: {
        organizationId,
        conversationId,
      },
    });

    if (!summary) {
      throw new Error('Customer summary not found');
    }

    return this.prisma.customerSummary.delete({
      where: { id: summary.id },
    });
  }
}
