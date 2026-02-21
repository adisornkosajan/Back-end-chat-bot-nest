import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FlowNode } from './chatbot-flows.service';

export interface FlowExecutionResult {
  responded: boolean;
  status: 'RUNNING' | 'PAUSED' | 'COMPLETED';
  messages: Array<{
    text: string;
    imageUrl?: string;
    quickReplies?: Array<{
      title: string;
      payload: string;
    }>;
    buttons?: Array<{
      type: 'postback' | 'web_url';
      title: string;
      payload?: string;
      url?: string;
    }>;
    carousel?: Array<{
      title: string;
      subtitle?: string;
      imageUrl?: string;
      buttons?: Array<{
        type: 'postback' | 'web_url';
        title: string;
        payload?: string;
        url?: string;
      }>;
    }>;
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
            const text = this.replaceVariables(currentNode.data.text, context);
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

        case 'quick_replies': {
          const text = this.replaceVariables(
            currentNode.data.text || 'Please choose an option:',
            context,
          );
          const quickReplies = (currentNode.data.quickReplies || [])
            .map((reply) => ({
              title: this.replaceVariables(reply.title || '', context),
              payload: this.replaceVariables(reply.payload || '', context),
            }))
            .filter((reply) => reply.title && reply.payload);

          if (quickReplies.length > 0) {
            result.messages.push({ text, quickReplies });
            result.responded = true;

            if (currentNode.nextNodeId) {
              await this.prisma.conversation.update({
                where: { id: context.conversationId },
                data: {
                  activeFlowId: flow.id,
                  activeFlowNodeId: currentNode.nextNodeId,
                  flowResumeAt: null,
                  flowState: context.flowState || null,
                } as any,
              });

              result.status = 'PAUSED';
              return result;
            }
          }

          currentNode = nodeMap.get(currentNode.nextNodeId || '');
          break;
        }

        case 'buttons': {
          const text = this.replaceVariables(
            currentNode.data.text || 'Please choose an option:',
            context,
          );
          const buttons = this.normalizeButtons(currentNode.data.buttons, context);

          if (buttons.length > 0) {
            result.messages.push({ text, buttons });
            result.responded = true;

            if (currentNode.nextNodeId) {
              await this.prisma.conversation.update({
                where: { id: context.conversationId },
                data: {
                  activeFlowId: flow.id,
                  activeFlowNodeId: currentNode.nextNodeId,
                  flowResumeAt: null,
                  flowState: context.flowState || null,
                } as any,
              });

              result.status = 'PAUSED';
              return result;
            }
          }

          currentNode = nodeMap.get(currentNode.nextNodeId || '');
          break;
        }

        case 'carousel': {
          const text = currentNode.data.text
            ? this.replaceVariables(currentNode.data.text, context)
            : '';

          const carousel = (currentNode.data.cards || [])
            .map((card) => {
              const buttons = this.normalizeButtons(card.buttons, context);
              const title = this.replaceVariables(card.title || '', context);
              const subtitle = card.subtitle
                ? this.replaceVariables(card.subtitle, context)
                : undefined;
              const imageUrl = card.imageUrl
                ? this.replaceVariables(card.imageUrl, context)
                : undefined;

              return {
                title,
                subtitle,
                imageUrl,
                ...(buttons.length > 0 && { buttons }),
              };
            })
            .filter((card) => card.title);

          if (carousel.length > 0) {
            result.messages.push({ text, carousel });
            result.responded = true;

            if (currentNode.nextNodeId) {
              await this.prisma.conversation.update({
                where: { id: context.conversationId },
                data: {
                  activeFlowId: flow.id,
                  activeFlowNodeId: currentNode.nextNodeId,
                  flowResumeAt: null,
                  flowState: context.flowState || null,
                } as any,
              });

              result.status = 'PAUSED';
              return result;
            }
          }

          currentNode = nodeMap.get(currentNode.nextNodeId || '');
          break;
        }

        case 'condition': {
          const conditionMet = this.evaluateCondition(currentNode, context);

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

    if (!conversation || !(conversation as any).activeFlowId) {
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

  private normalizeButtons(
    buttons:
      | Array<{
          type: 'postback' | 'web_url';
          title: string;
          payload?: string;
          url?: string;
        }>
      | undefined,
    context: {
      customerMessage: string;
      customerId: string;
      platform: any;
      flowState?: any;
    },
  ): Array<{
    type: 'postback' | 'web_url';
    title: string;
    payload?: string;
    url?: string;
  }> {
    return (buttons || [])
      .map((button) => {
        const type = button.type === 'web_url' ? 'web_url' : 'postback';
        const title = this.replaceVariables(button.title || '', context);
        const payload = button.payload
          ? this.replaceVariables(button.payload, context)
          : undefined;
        const url = button.url
          ? this.replaceVariables(button.url, context)
          : undefined;

        if (!title) return null;
        if (type === 'postback' && !payload) return null;
        if (type === 'web_url' && !url) return null;

        return {
          type: type as 'postback' | 'web_url',
          title,
          payload,
          url,
        };
      })
      .filter((button): button is NonNullable<typeof button> => !!button);
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
