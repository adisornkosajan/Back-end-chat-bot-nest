import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';

@Injectable()
export class CustomerSummaryService {
  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
  ) {}

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
    if (!userId) {
      throw new Error('User ID is required to create customer summary');
    }
    
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
        createdBy: userId,
      };
      
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

  async generateFromConversation(
    organizationId: string,
    conversationId: string,
    userId: string,
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId },
      include: { customer: true },
    });

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    const messages = await this.prisma.message.findMany({
      where: { organizationId, conversationId },
      select: { senderType: true, content: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 40,
    });

    if (!messages.length) {
      throw new Error('No messages to summarize');
    }

    const transcript = messages
      .map((m) => `${m.senderType === 'customer' ? 'Customer' : 'Agent'}: ${m.content || ''}`)
      .join('\n');

    const prompt = [
      'Summarize this support/sales conversation.',
      'Return strict JSON only with keys:',
      'summary, nextBestAction, customerName, mobile, email',
      'Do not include markdown.',
      `Default customerName to "${conversation.customer?.name || ''}" if unknown.`,
      '',
      'Conversation transcript:',
      transcript,
    ].join('\n');

    const aiText = await this.aiService.getAiResponse(
      prompt,
      conversationId,
      conversation.customerId,
    );

    const parsed = this.parseJsonFromText(aiText);
    const fallbackSummary = this.buildFallbackSummary(messages);
    const summaryText = this.asText(parsed?.summary) || fallbackSummary;
    const nextBestAction = this.asText(parsed?.nextBestAction) || 'Follow up with a clear next step and confirmation.';
    const customerName = this.asText(parsed?.customerName) || conversation.customer?.name || '';
    const mobile = this.asText(parsed?.mobile) || this.extractMobile(transcript) || '';
    const email = this.asText(parsed?.email) || this.extractEmail(transcript) || '';

    return this.upsert(
      organizationId,
      conversationId,
      {
        name: customerName,
        mobile,
        email,
        importantKey: `Summary: ${summaryText}\nNext Best Action: ${nextBestAction}`,
      },
      userId,
    );
  }

  private parseJsonFromText(text: string): any | null {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return null;
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
  }

  private asText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private buildFallbackSummary(
    messages: Array<{ senderType: string; content: string | null }>,
  ): string {
    const customerMessages = messages
      .filter((m) => m.senderType === 'customer' && m.content)
      .slice(-3)
      .map((m) => m.content as string);

    if (!customerMessages.length) {
      return 'Customer contacted support. Please review recent chat messages.';
    }

    return `Customer main points: ${customerMessages.join(' | ')}`;
  }

  private extractEmail(text: string): string {
    const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match ? match[0] : '';
  }

  private extractMobile(text: string): string {
    const match = text.match(/\b\d{9,15}\b/);
    return match ? match[0] : '';
  }
}
