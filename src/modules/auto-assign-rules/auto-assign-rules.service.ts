import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRole } from '@prisma/client';

export interface RuleConditions {
  keywords?: string[];
  platforms?: string[]; // facebook, instagram, whatsapp
  timeRange?: {
    start: string; // HH:mm format
    end: string; // HH:mm format
    timezone?: string;
  };
}

@Injectable()
export class AutoAssignRulesService {
  private readonly logger = new Logger(AutoAssignRulesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * List all rules for an organization (sorted by priority desc)
   */
  async listRules(organizationId: string) {
    return this.prisma.autoAssignRule.findMany({
      where: { organizationId },
      orderBy: { priority: 'desc' },
    });
  }

  /**
   * Get a single rule
   */
  async getRule(organizationId: string, ruleId: string) {
    const rule = await this.prisma.autoAssignRule.findFirst({
      where: { id: ruleId, organizationId },
    });

    if (!rule) {
      throw new NotFoundException('Rule not found');
    }

    return rule;
  }

  /**
   * Create a new rule
   */
  async createRule(
    organizationId: string,
    data: {
      name: string;
      type: string;
      conditions: RuleConditions;
      assignToAgentId?: string;
      priority?: number;
    },
  ) {
    return this.prisma.autoAssignRule.create({
      data: {
        organizationId,
        name: data.name,
        type: data.type,
        conditions: data.conditions as any,
        assignToAgentId: data.assignToAgentId || null,
        priority: data.priority || 0,
      },
    });
  }

  /**
   * Update a rule
   */
  async updateRule(
    organizationId: string,
    ruleId: string,
    data: {
      name?: string;
      type?: string;
      conditions?: RuleConditions;
      assignToAgentId?: string | null;
      priority?: number;
      isActive?: boolean;
    },
  ) {
    const rule = await this.getRule(organizationId, ruleId);

    return this.prisma.autoAssignRule.update({
      where: { id: rule.id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.type !== undefined && { type: data.type }),
        ...(data.conditions !== undefined && { conditions: data.conditions as any }),
        ...(data.assignToAgentId !== undefined && {
          assignToAgentId: data.assignToAgentId,
        }),
        ...(data.priority !== undefined && { priority: data.priority }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
  }

  /**
   * Toggle rule active status
   */
  async toggleRule(organizationId: string, ruleId: string) {
    const rule = await this.getRule(organizationId, ruleId);

    return this.prisma.autoAssignRule.update({
      where: { id: rule.id },
      data: { isActive: !rule.isActive },
    });
  }

  /**
   * Delete a rule
   */
  async deleteRule(organizationId: string, ruleId: string) {
    const rule = await this.getRule(organizationId, ruleId);

    await this.prisma.autoAssignRule.delete({ where: { id: rule.id } });
    return { message: 'Rule deleted successfully' };
  }

  /**
   * Evaluate rules for an incoming message and return the agent to assign to.
   * Returns agentId if a rule matches, null otherwise.
   */
  async evaluateRules(
    organizationId: string,
    messageContent: string,
    platformType: string,
  ): Promise<string | null> {
    const rules = await this.prisma.autoAssignRule.findMany({
      where: { organizationId, isActive: true },
      orderBy: { priority: 'desc' },
    });

    for (const rule of rules) {
      const conditions = rule.conditions as unknown as RuleConditions;
      let matches = false;

      switch (rule.type) {
        case 'keyword':
          if (conditions.keywords && conditions.keywords.length > 0) {
            const lowerMessage = messageContent.toLowerCase();
            matches = conditions.keywords.some((kw) =>
              lowerMessage.includes(kw.toLowerCase()),
            );
          }
          break;

        case 'platform':
          if (conditions.platforms && conditions.platforms.length > 0) {
            matches = conditions.platforms.includes(platformType);
          }
          break;

        case 'time_based':
          if (conditions.timeRange) {
            const now = new Date();
            const currentTime =
              now.getHours().toString().padStart(2, '0') +
              ':' +
              now.getMinutes().toString().padStart(2, '0');
            matches =
              currentTime >= conditions.timeRange.start &&
              currentTime <= conditions.timeRange.end;
          }
          break;

        case 'round_robin':
          // Always matches — round-robin assigns to the agent with least conversations
          matches = true;
          break;
      }

      if (matches) {
        if (rule.assignToAgentId) {
          return rule.assignToAgentId;
        }

        // Round-robin: find agent with fewest active conversations
        const agents = await this.prisma.user.findMany({
          where: {
            organizationId,
            role: {
              in: [UserRole.USER, UserRole.MANAGER, UserRole.ADMIN],
            },
          },
          select: { id: true },
        });

        if (agents.length === 0) return null;

        const agentCounts = await Promise.all(
          agents.map(async (agent) => ({
            agentId: agent.id,
            count: await this.prisma.conversation.count({
              where: {
                organizationId,
                assignedAgentId: agent.id,
                status: { in: ['OPEN', 'IN_PROGRESS'] },
              },
            }),
          })),
        );

        agentCounts.sort((a, b) => a.count - b.count);
        return agentCounts[0].agentId;
      }
    }

    return null;
  }
}
