import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FlowNode } from './chatbot-flows.service';

export interface FlowExecutionResult {
  responded: boolean;
  status: 'RUNNING' | 'PAUSED' | 'COMPLETED';
  messages: Array<{
    text: string;
    imageUrl?: string;
    location?: {
      latitude: number;
      longitude: number;
      name?: string;
      address?: string;
    };
  }>;
  actions: Array<{ action: string; value?: string }>;
}

@Injectable()
export class FlowEngineService {
  private readonly logger = new Logger(FlowEngineService.name);

  constructor(private readonly prisma: PrismaService) {}

  async executeFlow(
    flow: any,
    context: {
      customerMessage: string;
      customerId: string;
      platform: any;
      conversationId: string;
      organizationId: string;
      flowState?: any;
    },
    startNodeId?: string,
  ): Promise<FlowExecutionResult> {
    const nodes = (flow.nodes as FlowNode[]) || [];
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    const result: FlowExecutionResult = {
      responded: false,
      status: 'RUNNING',
      messages: [],
      actions: [],
    };

    if (nodes.length === 0) {
      result.status = 'COMPLETED';
      return result;
    }

    let currentNode: FlowNode | undefined = startNodeId
      ? nodeMap.get(startNodeId)
      : nodes[0];

    let maxSteps = 50;

    while (currentNode && maxSteps > 0) {
      maxSteps--;

      this.logger.debug(
        `Executing node ${currentNode.id} (${currentNode.type})`,
      );

      switch (currentNode.type) {
        case 'message': {
          if (currentNode.data.text) {
            const text = this.replaceVariables(
              currentNode.data.text,
              context,
            );
            result.messages.push({ text });
            result.responded = true;
          }

          if (currentNode.data.imageUrl) {
            result.messages.push({
              text: '',
              imageUrl: currentNode.data.imageUrl,
            });
            result.responded = true;
          }

          currentNode = nodeMap.get(currentNode.nextNodeId || '');
          break;
        }

        case 'condition': {
          const conditionMet = this.evaluateCondition(
            currentNode,
            context,
          );

          currentNode = conditionMet
            ? nodeMap.get(currentNode.conditionTrueNodeId || '')
            : nodeMap.get(currentNode.conditionFalseNodeId || '');

          break;
        }

        case 'delay': {
          const delayMs = currentNode.data.delayMs || 1000;

          await this.prisma.conversation.update({
            where: { id: context.conversationId },
            data: {
              activeFlowId: flow.id,
              activeFlowNodeId: currentNode.nextNodeId,
              flowResumeAt: new Date(Date.now() + delayMs),
            } as any,
          });

          result.status = 'PAUSED';
          return result;
        }

        case 'collect_input': {
          if (currentNode.data.prompt) {
            const text = this.replaceVariables(
              currentNode.data.prompt,
              context,
            );
            result.messages.push({ text });
            result.responded = true;
          }

          await this.prisma.conversation.update({
            where: { id: context.conversationId },
            data: {
              activeFlowId: flow.id,
              activeFlowNodeId: currentNode.nextNodeId,
              flowResumeAt: null,
              flowState: {
                ...(context.flowState || {}),
                awaitingVariable: currentNode.data.saveAs,
              },
            } as any,
          });

          result.status = 'PAUSED';
          return result;
        }

        case 'action': {
          if (currentNode.data.action) {
            result.actions.push({
              action: currentNode.data.action,
              value: currentNode.data.actionValue,
            });
          }

          currentNode = nodeMap.get(currentNode.nextNodeId || '');
          break;
        }

        case 'location': {
          if (currentNode.data.latitude && currentNode.data.longitude) {
            const name = currentNode.data.locationName || '';
            const address = currentNode.data.locationAddress || '';
            const mapsUrl = `https://www.google.com/maps?q=${currentNode.data.latitude},${currentNode.data.longitude}`;

            const text = name
              ? `📍 ${name}${address ? '\n' + address : ''}\n${mapsUrl}`
              : mapsUrl;

            result.messages.push({
              text,
              location: {
                latitude: currentNode.data.latitude,
                longitude: currentNode.data.longitude,
                name,
                address,
              },
            });

            result.responded = true;
          }

          currentNode = nodeMap.get(currentNode.nextNodeId || '');
          break;
        }

        default:
          currentNode = nodeMap.get(currentNode.nextNodeId || '');
          break;
      }
    }

    // Flow finished normally
    await this.prisma.conversation.update({
      where: { id: context.conversationId },
      data: {
        activeFlowId: null,
        activeFlowNodeId: null,
        flowResumeAt: null,
        flowState: null,
      } as any,
    });

    result.status = 'COMPLETED';
    return result;
  }

  async continueFlow(conversationId: string, inputMessage?: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { organization: true, platform: true },
    });

    if (
      !conversation ||
      !(conversation as any).activeFlowId ||
      !(conversation as any).activeFlowNodeId
    ) {
      return null;
    }

    const flow = await this.prisma.chatbotFlow.findUnique({
      where: { id: (conversation as any).activeFlowId },
    });

    if (!flow) return null;

    let flowState = (conversation as any).flowState || {};

    // Capture user input if awaiting variable
    if (inputMessage && flowState.awaitingVariable) {
      flowState = {
        ...flowState,
        [flowState.awaitingVariable]: inputMessage,
        awaitingVariable: null,
      };

      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { flowState } as any,
      });
    }

    const context = {
      customerMessage: inputMessage || '',
      customerId: conversation.customerId,
      platform: conversation.platform,
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      flowState,
    };

    const result = await this.executeFlow(
      flow,
      context,
      (conversation as any).activeFlowNodeId,
    );

    return result;
  }

  private evaluateCondition(
    node: FlowNode,
    context: {
      customerMessage: string;
      customerId: string;
      platform: any;
      flowState?: any;
    },
  ): boolean {
    const { variable, operator, value } = node.data;
    if (!variable || !operator || !value) return false;

    let actual = '';

    if (variable === 'message') {
      actual = context.customerMessage.toLowerCase();
    } else if (variable === 'platform') {
      actual = context.platform?.type?.toLowerCase() || '';
    } else if (context.flowState?.[variable]) {
      actual = String(context.flowState[variable]).toLowerCase();
    } else {
      return false;
    }

    const expected = String(value).toLowerCase();

    switch (operator) {
      case 'contains':
        return actual.includes(expected);
      case 'equals':
        return actual === expected;
      case 'startsWith':
        return actual.startsWith(expected);
      case 'endsWith':
        return actual.endsWith(expected);
      case 'not_contains':
        return !actual.includes(expected);
      default:
        return false;
    }
  }

  private replaceVariables(
    text: string,
    context: {
      customerMessage: string;
      customerId: string;
      platform: any;
      flowState?: any;
    },
  ): string {
    let output = text
      .replace(/\{customer_message\}/g, context.customerMessage)
      .replace(/\{platform\}/g, context.platform?.type || '')
      .replace(/\{customer_id\}/g, context.customerId);

    if (context.flowState) {
      Object.keys(context.flowState).forEach((key) => {
        if (context.flowState[key]) {
          const regex = new RegExp(`\\{${key}\\}`, 'g');
          output = output.replace(regex, context.flowState[key]);
        }
      });
    }

    return output;
  }
}
