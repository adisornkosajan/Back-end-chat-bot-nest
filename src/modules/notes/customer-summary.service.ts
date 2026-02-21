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
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        organizationId,
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
          phone: true,
          },
        },
      },
    });

    if (!conversation) {
      return null;
    }

    const summary = await this.prisma.customerSummary.findFirst({
      where: {
        organizationId,
        conversationId,
      },
    });

    // First-open fallback: return contact identity fields even when
    // no summary record has been created yet.
    if (!summary) {
      const fallbackMessages = await this.prisma.message.findMany({
        where: {
          organizationId,
          conversationId,
          senderType: 'customer',
        },
        select: { senderType: true, content: true, contentType: true },
        orderBy: { createdAt: 'desc' },
        take: 3,
      });

      const fallbackImportant =
        fallbackMessages.length > 0
          ? this.buildFallbackSummary(fallbackMessages.reverse())
          : '';

      return {
        id: '',
        organizationId,
        conversationId,
        customerId: conversation.customer.id,
        name: conversation.customer.name ?? null,
        email: conversation.customer.email ?? null,
        mobile: conversation.customer.phone ?? null,
        importantKey: fallbackImportant || null,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        isFallback: true,
      };
    }

    return {
      ...summary,
      customerId: conversation.customer.id,
      name: summary.name ?? conversation.customer.name ?? null,
      email: summary.email ?? conversation.customer.email ?? null,
      mobile: summary.mobile ?? conversation.customer.phone ?? null,
    };
  }

  async getHistory(organizationId: string, conversationId: string) {
    const summary = await this.prisma.customerSummary.findFirst({
      where: {
        organizationId,
        conversationId,
      },
    });

    if (!summary) {
      return [];
    }

    return this.prisma.customerSummaryHistory.findMany({
      where: {
        summaryId: summary.id,
      },
      include: {
        editor: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        editedAt: 'desc',
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

    const normalizedName = this.normalizeOptionalText(data.name);
    const normalizedMobile = this.normalizeOptionalText(data.mobile);
    const normalizedEmail = this.normalizeOptionalText(data.email);
    const normalizedImportantKey = this.normalizeOptionalText(data.importantKey);

    const summaryPatch: any = {};
    if (data.name !== undefined) summaryPatch.name = normalizedName;
    if (data.mobile !== undefined) summaryPatch.mobile = normalizedMobile;
    if (data.email !== undefined) summaryPatch.email = normalizedEmail;
    if (data.importantKey !== undefined)
      summaryPatch.importantKey = normalizedImportantKey;

    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        organizationId,
      },
      select: {
        id: true,
        customerId: true,
      },
    });

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    return this.prisma.$transaction(async (tx) => {
      // Check if summary already exists
      const existing = await tx.customerSummary.findFirst({
        where: {
          organizationId,
          conversationId,
        },
      });

      let savedSummary: any;
      if (existing) {
        await tx.customerSummaryHistory.create({
          data: {
            summaryId: existing.id,
            name: existing.name,
            mobile: existing.mobile,
            email: existing.email,
            importantKey: existing.importantKey,
            editedBy: userId,
          },
        });

        // Update existing summary
        savedSummary = await tx.customerSummary.update({
          where: { id: existing.id },
          data: {
            ...summaryPatch,
            updatedAt: new Date(),
          },
        });
      } else {
        // Create new summary
        savedSummary = await tx.customerSummary.create({
          data: {
            organizationId,
            conversationId,
            ...summaryPatch,
            createdBy: userId,
          },
        });
      }

      // Sync summary identity fields back to Contacts (customer record).
      const customerPatch: any = {};
      if (data.name !== undefined) customerPatch.name = normalizedName;
      if (data.mobile !== undefined) customerPatch.phone = normalizedMobile;
      if (data.email !== undefined) customerPatch.email = normalizedEmail;

      if (Object.keys(customerPatch).length > 0) {
        await tx.customer.update({
          where: { id: conversation.customerId },
          data: customerPatch,
        });
      }

      return savedSummary;
    });
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
    const fallbackSummary =
      this.buildFallbackSummary(messages) ||
      'Customer contacted support. Please review recent chat messages.';
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
    messages: Array<{
      senderType: string;
      content: string | null;
      contentType?: string | null;
    }>,
  ): string {
    const customerMessages = messages
      .filter((m) => m.senderType === 'customer' && m.content)
      .map((m) => this.normalizeMessageText(m.content))
      .filter((content) => this.isMeaningfulCustomerMessage(content))
      .slice(-3)
      .map((content) => content as string);

    if (!customerMessages.length) {
      return '';
    }

    return `Customer main points: ${customerMessages.join(' | ')}`;
  }

  private normalizeMessageText(value: string | null): string {
    if (!value) return '';
    return value.replace(/\s+/g, ' ').trim();
  }

  private isMeaningfulCustomerMessage(content: string): boolean {
    if (!content) return false;

    const lower = content.toLowerCase();
    const upper = content.toUpperCase();

    const isMenuPayload =
      /^MENU_[A-Z0-9_]+$/.test(upper) ||
      /^BUTTON_[A-Z0-9_]+$/.test(upper) ||
      /^BTN_[A-Z0-9_]+$/.test(upper) ||
      /^PAYLOAD\s*:/.test(upper) ||
      /^[A-D]$/.test(upper);

    if (isMenuPayload) return false;

    const lowValueInputs = new Set([
      'hi',
      'hii',
      'hello',
      'hey',
      'ok',
      'okay',
      'yes',
      'no',
      'test',
      'aaa',
      'bbb',
      'ccc',
      'สวัสดี',
      'ครับ',
      'ค่ะ',
    ]);

    if (lowValueInputs.has(lower)) return false;

    if (content.length <= 2) return false;

    return true;
  }

  private extractEmail(text: string): string {
    const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match ? match[0] : '';
  }

  private extractMobile(text: string): string {
    const match = text.match(/\b\d{9,15}\b/);
    return match ? match[0] : '';
  }

  private normalizeOptionalText(
    value: string | null | undefined,
  ): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
}
