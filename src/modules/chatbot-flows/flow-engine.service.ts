import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FlowNode } from './chatbot-flows.service';

export interface FlowExecutionResult {
  responded: boolean;
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

  /**
   * Execute a chatbot flow starting from the first node
   */
  async executeFlow(
    flow: any,
    context: {
      customerMessage: string;
      customerId: string;
      platform: any;
      conversationId: string;
      organizationId: string;
    },
  ): Promise<FlowExecutionResult> {
    const nodes = (flow.nodes as FlowNode[]) || [];
    const result: FlowExecutionResult = {
      responded: false,
      messages: [],
      actions: [],
    };

    if (nodes.length === 0) {
      return result;
    }

    // Start from the first node
    let currentNode: FlowNode | undefined = nodes[0];
    let maxSteps = 50; // Prevent infinite loops

    while (currentNode && maxSteps > 0) {
      maxSteps--;

      this.logger.debug(
        `Executing node ${currentNode.id} (${currentNode.type})`,
      );

      switch (currentNode.type) {
        case 'message':
          // แยกส่ง text และ image เป็นคนละ message
          if (currentNode.data.text) {
            const text = this.replaceVariables(currentNode.data.text, context);
            result.messages.push({
              text,
            });
            result.responded = true;
          }
          if (currentNode.data.imageUrl) {
            result.messages.push({
              text: '',
              imageUrl: currentNode.data.imageUrl,
            });
            result.responded = true;
          }
          currentNode = this.getNextNode(nodes, currentNode.nextNodeId);
          break;

        case 'condition':
          const conditionMet = this.evaluateCondition(currentNode, context);
          if (conditionMet) {
            currentNode = this.getNextNode(
              nodes,
              currentNode.conditionTrueNodeId,
            );
          } else {
            currentNode = this.getNextNode(
              nodes,
              currentNode.conditionFalseNodeId,
            );
          }
          break;

        case 'delay':
          // In real-time execution, we collect delays but don't actually wait
          // For now, skip delay nodes
          currentNode = this.getNextNode(nodes, currentNode.nextNodeId);
          break;

        case 'action':
          if (currentNode.data.action) {
            result.actions.push({
              action: currentNode.data.action,
              value: currentNode.data.actionValue,
            });
          }
          currentNode = this.getNextNode(nodes, currentNode.nextNodeId);
          break;

        case 'collect_input':
          // For collect_input, we send the prompt and stop execution
          // The next message from the customer would continue the flow
          if (currentNode.data.prompt) {
            result.messages.push({ text: currentNode.data.prompt });
            result.responded = true;
          }
          // Stop here — waiting for user input
          currentNode = undefined;
          break;

        case 'location':
          if (currentNode.data.latitude && currentNode.data.longitude) {
            const locationName = currentNode.data.locationName || '';
            const locationAddress = currentNode.data.locationAddress || '';
            const mapsUrl = `https://www.google.com/maps?q=${currentNode.data.latitude},${currentNode.data.longitude}`;
            const text = locationName
              ? `📍 ${locationName}${locationAddress ? '\n' + locationAddress : ''}\n${mapsUrl}`
              : mapsUrl;
            result.messages.push({
              text,
              location: {
                latitude: currentNode.data.latitude,
                longitude: currentNode.data.longitude,
                name: locationName,
                address: locationAddress,
              },
            });
            result.responded = true;
          }
          currentNode = this.getNextNode(nodes, currentNode.nextNodeId);
          break;

        default:
          currentNode = this.getNextNode(nodes, currentNode.nextNodeId);
          break;
      }
    }

    return result;
  }

  /**
   * Get the next node by ID
   */
  private getNextNode(
    nodes: FlowNode[],
    nodeId?: string | null,
  ): FlowNode | undefined {
    if (!nodeId) return undefined;
    return nodes.find((n) => n.id === nodeId);
  }

  /**
   * Evaluate a condition node
   */
  private evaluateCondition(
    node: FlowNode,
    context: {
      customerMessage: string;
      customerId: string;
      platform: any;
    },
  ): boolean {
    const { variable, operator, value } = node.data;
    if (!variable || !operator || !value) return false;

    let actual = '';

    switch (variable) {
      case 'message':
        actual = context.customerMessage.toLowerCase();
        break;
      case 'platform':
        actual = context.platform?.type?.toLowerCase() || '';
        break;
      default:
        return false;
    }

    const expected = value.toLowerCase();

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

  /**
   * Replace template variables in text
   */
  private replaceVariables(
    text: string,
    context: {
      customerMessage: string;
      customerId: string;
      platform: any;
    },
  ): string {
    return text
      .replace(/\{customer_message\}/g, context.customerMessage)
      .replace(/\{platform\}/g, context.platform?.type || '')
      .replace(/\{customer_id\}/g, context.customerId);
  }
}
