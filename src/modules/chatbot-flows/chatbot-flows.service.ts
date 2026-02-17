import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface FlowNode {
  id: string;
  type: 'message' | 'condition' | 'delay' | 'action' | 'collect_input' | 'location';
  data: {
    // message type
    text?: string;
    imageUrl?: string;
    // condition type
    variable?: string; // e.g., 'message', 'platform', 'tag'
    operator?: string; // contains, equals, startsWith
    value?: string;
    // delay type
    delayMs?: number;
    // action type
    action?: string; // assign_agent, add_tag, request_human, close
    actionValue?: string;
    // collect_input type
    prompt?: string;
    saveAs?: string; // variable name to store response
    // location type
    latitude?: number;
    longitude?: number;
    locationName?: string;
    locationAddress?: string;
  };
  nextNodeId?: string | null; // next node ID (linear flow)
  conditionTrueNodeId?: string | null; // if condition is true
  conditionFalseNodeId?: string | null; // if condition is false
}

@Injectable()
export class ChatbotFlowsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List all flows for an organization
   */
  async listFlows(organizationId: string) {
    // Increase sort buffer to handle large JSON columns
    await this.prisma.$executeRawUnsafe(`SET SESSION sort_buffer_size = 8388608`);
    return this.prisma.chatbotFlow.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get a single flow
   */
  async getFlow(organizationId: string, flowId: string) {
    const flow = await this.prisma.chatbotFlow.findFirst({
      where: { id: flowId, organizationId },
    });

    if (!flow) {
      throw new NotFoundException('Flow not found');
    }

    return flow;
  }

  /**
   * Create a new flow
   */
  async createFlow(
    organizationId: string,
    userId: string,
    data: {
      name: string;
      description?: string;
      triggerKeywords?: string[];
      nodes?: FlowNode[];
    },
  ) {
    return this.prisma.chatbotFlow.create({
      data: {
        organizationId,
        name: data.name,
        description: data.description,
        triggerKeywords: data.triggerKeywords as any,
        nodes: (data.nodes || []) as any,
        createdBy: userId,
      },
    });
  }

  /**
   * Update a flow
   */
  async updateFlow(
    organizationId: string,
    flowId: string,
    data: {
      name?: string;
      description?: string;
      triggerKeywords?: string[];
      nodes?: FlowNode[];
      isActive?: boolean;
    },
  ) {
    const flow = await this.getFlow(organizationId, flowId);

    return this.prisma.chatbotFlow.update({
      where: { id: flow.id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.triggerKeywords !== undefined && {
          triggerKeywords: data.triggerKeywords as any,
        }),
        ...(data.nodes !== undefined && { nodes: data.nodes as any }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
  }

  /**
   * Toggle flow active status
   */
  async toggleFlow(organizationId: string, flowId: string) {
    const flow = await this.getFlow(organizationId, flowId);

    return this.prisma.chatbotFlow.update({
      where: { id: flow.id },
      data: { isActive: !flow.isActive },
    });
  }

  /**
   * Delete a flow
   */
  async deleteFlow(organizationId: string, flowId: string) {
    const flow = await this.getFlow(organizationId, flowId);

    await this.prisma.chatbotFlow.delete({ where: { id: flow.id } });
    return { message: 'Flow deleted successfully' };
  }

  /**
   * Find matching flow for a message
   */
  async findMatchingFlow(
    organizationId: string,
    message: string,
  ): Promise<any | null> {
    const activeFlows = await this.prisma.chatbotFlow.findMany({
      where: { organizationId, isActive: true },
    });

    const lowerMessage = message.toLowerCase();

    for (const flow of activeFlows) {
      const keywords = (flow.triggerKeywords as string[]) || [];
      for (const keyword of keywords) {
        // Strip leading # from keywords (users may prefix with #)
        const cleanKeyword = keyword.replace(/^#/, '').toLowerCase();
        if (cleanKeyword && lowerMessage.includes(cleanKeyword)) {
          return flow;
        }
      }
    }

    return null;
  }
}
