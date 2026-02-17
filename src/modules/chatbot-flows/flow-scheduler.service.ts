import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { FlowEngineService } from './flow-engine.service';
import { MessagingService } from '../messaging/messaging.service';

@Injectable()
export class FlowSchedulerService {
  private readonly logger = new Logger(FlowSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly flowEngine: FlowEngineService,
    @Inject(forwardRef(() => MessagingService))
    private readonly messagingService: MessagingService,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async checkDelayedFlows() {
    const now = new Date();

    const dueConversations = await this.prisma.conversation.findMany({
      where: {
        flowResumeAt: { lte: now },
        activeFlowId: { not: null },
        activeFlowNodeId: { not: null },
      },
      select: { id: true },
    });

    if (dueConversations.length === 0) return;

    this.logger.log(`Found ${dueConversations.length} flows to resume.`);

    for (const conv of dueConversations) {
      try {
        /**
         * Atomic lock:
         * Only resume if flowResumeAt still <= now
         * and still active
         */
        const lock = await this.prisma.conversation.updateMany({
          where: {
            id: conv.id,
            flowResumeAt: { lte: now },
            activeFlowId: { not: null },
            activeFlowNodeId: { not: null },
          },
          data: {
            flowResumeAt: null,
          },
        });

        // If 0 rows updated → another instance took it
        if (lock.count === 0) {
          continue;
        }

        const result = await this.flowEngine.continueFlow(conv.id);

        if (!result) continue;

        if (result.messages.length > 0) {
          await this.messagingService.sendFlowMessages(
            conv.id,
            result.messages,
          );
        }

      } catch (err) {
        this.logger.error(
          `Failed to resume flow for conv ${conv.id}: ${err?.message}`,
        );
      }
    }
  }
}
