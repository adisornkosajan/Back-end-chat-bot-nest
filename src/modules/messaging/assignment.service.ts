import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ConversationStatus, UserRole } from '@prisma/client';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Injectable()
export class AssignmentService {
  private readonly logger = new Logger(AssignmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * Assign conversation to an agent
   */
  async assignConversation(
    conversationId: string,
    agentId: string,
    organizationId: string,
  ) {
    // Verify conversation belongs to organization
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        organizationId,
      },
      include: {
        customer: true,
        platform: true,
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    // Verify agent belongs to organization
    const agent = await this.prisma.user.findFirst({
      where: {
        id: agentId,
        organizationId,
      },
    });

    if (!agent) {
      throw new NotFoundException('Agent not found');
    }

    // Update conversation
    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        assignedAgentId: agentId,
        status: ConversationStatus.IN_PROGRESS,
        updatedAt: new Date(),
      },
      include: {
        customer: true,
        platform: true,
        messages: {
          orderBy: { sentAt: 'desc' },
          take: 1,
        },
      },
    });

    this.logger.log(
      `✅ Conversation ${conversationId} assigned to ${agent.name} (${agentId})`,
    );

    // Notify via WebSocket
    this.realtime.notifyConversationUpdate(organizationId, updated);

    return updated;
  }

  /**
   * Unassign conversation from agent
   */
  async unassignConversation(conversationId: string, organizationId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        organizationId,
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        assignedAgentId: null,
        status: ConversationStatus.OPEN,
        updatedAt: new Date(),
      },
      include: {
        customer: true,
        platform: true,
        messages: {
          orderBy: { sentAt: 'desc' },
          take: 1,
        },
      },
    });

    this.logger.log(`✅ Conversation ${conversationId} unassigned`);

    // Notify via WebSocket
    this.realtime.notifyConversationUpdate(organizationId, updated);

    return updated;
  }

  /**
   * Change conversation status
   */
  async changeStatus(
    conversationId: string,
    status: ConversationStatus,
    organizationId: string,
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        organizationId,
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        status,
        updatedAt: new Date(),
      },
      include: {
        customer: true,
        platform: true,
        messages: {
          orderBy: { sentAt: 'desc' },
          take: 1,
        },
      },
    });

    this.logger.log(
      `✅ Conversation ${conversationId} status changed to ${status}`,
    );

    // Notify via WebSocket
    this.realtime.notifyConversationUpdate(organizationId, updated);

    return updated;
  }

  /**
   * Get unassigned conversations
   */
  async getUnassigned(organizationId: string) {
    return this.prisma.conversation.findMany({
      where: {
        organizationId,
        assignedAgentId: null,
        status: ConversationStatus.OPEN,
      },
      include: {
        customer: true,
        platform: true,
        messages: {
          orderBy: { sentAt: 'desc' },
          take: 1,
        },
      },
      orderBy: {
        lastMessageAt: 'desc',
      },
    });
  }

  /**
   * Auto-assign next available conversation (round-robin)
   */
  async autoAssign(organizationId: string) {
    // Get all active agents in organization
    const agents = await this.prisma.user.findMany({
      where: {
        organizationId,
        role: { in: [UserRole.USER, UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPER_ADMIN] },
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (agents.length === 0) {
      throw new BadRequestException('No available agents');
    }

    // Count conversations per agent
    const agentConversations = await Promise.all(
      agents.map(async (agent) => {
        const count = await this.prisma.conversation.count({
          where: {
            organizationId,
            assignedAgentId: agent.id,
            status: {
              in: [ConversationStatus.OPEN, ConversationStatus.IN_PROGRESS],
            },
          },
        });
        return { agentId: agent.id, name: agent.name, count };
      }),
    );

    // Sort by count (ascending) to get agent with least conversations
    agentConversations.sort((a, b) => a.count - b.count);
    const selectedAgent = agentConversations[0];

    // Get oldest unassigned conversation
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        organizationId,
        assignedAgentId: null,
        status: ConversationStatus.OPEN,
      },
      orderBy: {
        createdAt: 'asc', // Oldest first
      },
    });

    if (!conversation) {
      throw new NotFoundException('No unassigned conversations available');
    }

    // Assign it
    return this.assignConversation(
      conversation.id,
      selectedAgent.agentId,
      organizationId,
    );
  }

  /**
   * Transfer conversation to another agent
   */
  async transferConversation(
    conversationId: string,
    fromAgentId: string,
    toAgentId: string,
    organizationId: string,
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        organizationId,
        assignedAgentId: fromAgentId,
      },
    });

    if (!conversation) {
      throw new NotFoundException(
        'Conversation not found or not assigned to source agent',
      );
    }

    // Verify target agent exists
    const targetAgent = await this.prisma.user.findFirst({
      where: {
        id: toAgentId,
        organizationId,
      },
    });

    if (!targetAgent) {
      throw new NotFoundException('Target agent not found');
    }

    return this.assignConversation(conversationId, toAgentId, organizationId);
  }

  /**
   * Get agent's assigned conversations
   */
  async getAgentConversations(agentId: string, organizationId: string) {
    return this.prisma.conversation.findMany({
      where: {
        organizationId,
        assignedAgentId: agentId,
        status: {
          in: [ConversationStatus.OPEN, ConversationStatus.IN_PROGRESS],
        },
      },
      include: {
        customer: true,
        platform: true,
        messages: {
          orderBy: { sentAt: 'desc' },
          take: 1,
        },
      },
      orderBy: {
        lastMessageAt: 'desc',
      },
    });
  }
}
