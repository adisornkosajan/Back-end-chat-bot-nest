import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardStats(organizationId: string) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Parallel queries for better performance
    const [
      totalConversations,
      todayConversations,
      weekConversations,
      monthConversations,
      totalMessages,
      todayMessages,
      messagesByPlatform,
      conversationsByStatus,
      agentPerformance,
      activeConversations,
      avgResponseTime,
    ] = await Promise.all([
      // Total conversations
      this.prisma.conversation.count({
        where: { organizationId },
      }),

      // Today's conversations
      this.prisma.conversation.count({
        where: {
          organizationId,
          createdAt: { gte: today },
        },
      }),

      // This week's conversations
      this.prisma.conversation.count({
        where: {
          organizationId,
          createdAt: { gte: thisWeek },
        },
      }),

      // This month's conversations
      this.prisma.conversation.count({
        where: {
          organizationId,
          createdAt: { gte: thisMonth },
        },
      }),

      // Total messages
      this.prisma.message.count({
        where: { conversation: { organizationId } },
      }),

      // Today's messages
      this.prisma.message.count({
        where: {
          conversation: { organizationId },
          createdAt: { gte: today },
        },
      }),

      // Messages by platform
      this.prisma.conversation.groupBy({
        by: ['platformId'],
        where: { organizationId },
        _count: { id: true },
      }),

      // Conversations by status
      this.prisma.conversation.groupBy({
        by: ['status'],
        where: { organizationId },
        _count: { id: true },
      }),

      // Agent performance
      this.prisma.conversation.groupBy({
        by: ['assignedAgentId'],
        where: {
          organizationId,
          assignedAgentId: { not: null },
        },
        _count: { id: true },
      }),

      // Active conversations (have messages in last 24 hours)
      this.prisma.conversation.count({
        where: {
          organizationId,
          messages: {
            some: {
              createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
            },
          },
        },
      }),

      // Average response time (simplified - time between customer message and agent response)
      this.calculateAverageResponseTime(organizationId),
    ]);

    // Get platform details for platform stats
    const platformIds = messagesByPlatform
      .filter((p) => p.platformId)
      .map((p) => p.platformId as string);

    const platforms = await this.prisma.platform.findMany({
      where: { id: { in: platformIds } },
      select: { id: true, type: true },
    });

    // Get agent details for performance data
    const agentIds = agentPerformance
      .filter((a) => a.assignedAgentId)
      .map((a) => a.assignedAgentId as string);

    const agents = await this.prisma.user.findMany({
      where: { id: { in: agentIds } },
      select: { id: true, name: true, email: true },
    });

    const agentStats = agentPerformance.map((stat) => {
      const agent = agents.find((a) => a.id === stat.assignedAgentId);
      return {
        agentId: stat.assignedAgentId,
        agentName: agent?.name || 'Unknown',
        agentEmail: agent?.email || '',
        conversationCount: stat._count?.id || 0,
      };
    });

    return {
      summary: {
        totalConversations,
        todayConversations,
        weekConversations,
        monthConversations,
        totalMessages,
        todayMessages,
        activeConversations,
        avgResponseTime: avgResponseTime || 0,
      },
      platformStats: messagesByPlatform.map((stat) => {
        const platform = platforms.find((p) => p.id === stat.platformId);
        return {
          platform: platform?.type || 'Unknown',
          count: stat._count?.id || 0,
        };
      }),
      statusStats: conversationsByStatus.map((stat) => ({
        status: stat.status,
        count: stat._count?.id || 0,
      })),
      agentStats: agentStats.sort((a, b) => b.conversationCount - a.conversationCount),
    };
  }

  async getConversationTrend(organizationId: string, days: number = 7) {
    const trends: Array<{ date: string; count: number }> = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

      const count = await this.prisma.conversation.count({
        where: {
          organizationId,
          createdAt: {
            gte: startOfDay,
            lt: endOfDay,
          },
        },
      });

      trends.push({
        date: startOfDay.toISOString().split('T')[0],
        count,
      });
    }

    return trends;
  }

  async getPeakHours(organizationId: string) {
    // Get messages from last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const messages = await this.prisma.message.findMany({
      where: {
        conversation: { organizationId },
        createdAt: { gte: thirtyDaysAgo },
      },
      select: { createdAt: true },
    });

    // Group by hour
    const hourCounts = Array(24).fill(0);
    messages.forEach((msg) => {
      const hour = new Date(msg.createdAt).getHours();
      hourCounts[hour]++;
    });

    return hourCounts.map((count, hour) => ({
      hour,
      count,
      label: `${hour.toString().padStart(2, '0')}:00`,
    }));
  }

  private async calculateAverageResponseTime(organizationId: string): Promise<number> {
    // Get conversations with at least 2 messages
    const conversations = await this.prisma.conversation.findMany({
      where: { organizationId },
      select: {
        id: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            createdAt: true,
            senderType: true,
          },
        },
      },
    });

    let totalResponseTime = 0;
    let responseCount = 0;

    conversations.forEach((conv) => {
      const messages = conv.messages;
      for (let i = 0; i < messages.length - 1; i++) {
        const current = messages[i];
        const next = messages[i + 1];

        // If customer message followed by agent message
        if (current.senderType === 'customer' && next.senderType === 'agent') {
          const responseTime =
            new Date(next.createdAt).getTime() - new Date(current.createdAt).getTime();
          totalResponseTime += responseTime;
          responseCount++;
        }
      }
    });

    if (responseCount === 0) return 0;

    // Return average in seconds
    return Math.round(totalResponseTime / responseCount / 1000);
  }
}
