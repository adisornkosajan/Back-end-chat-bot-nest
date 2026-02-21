import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MessagingService } from '../messaging/messaging.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BroadcastStatus, BroadcastRecipientStatus } from '@prisma/client';

@Injectable()
export class BroadcastsService {
  private readonly logger = new Logger(BroadcastsService.name);
  private readonly broadcastBatchSize = Math.max(
    1,
    Number.parseInt(process.env.BROADCAST_BATCH_SIZE || '50', 10) || 50,
  );
  private readonly broadcastFailureThresholdPercent = Math.min(
    100,
    Math.max(
      0,
      Number.parseFloat(process.env.BROADCAST_FAILURE_THRESHOLD_PERCENT || '100') ||
        100,
    ),
  );
  private isProcessingQueue = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messagingService: MessagingService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * List all broadcasts for an organization
   */
  async listBroadcasts(organizationId: string) {
    return this.prisma.broadcast.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { recipients: true } },
      },
    });
  }

  /**
   * Get broadcast detail with recipient stats
   */
  async getBroadcast(organizationId: string, broadcastId: string) {
    const broadcast = await this.prisma.broadcast.findFirst({
      where: { id: broadcastId, organizationId },
      include: {
        recipients: {
          take: 100,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!broadcast) {
      throw new NotFoundException('Broadcast not found');
    }

    return broadcast;
  }

  /**
   * Create a new broadcast (draft)
   */
  async createBroadcast(
    organizationId: string,
    userId: string,
    data: {
      name: string;
      message: string;
      imageUrl?: string;
      platformType?: string;
      filterTags?: string[];
      scheduledAt?: string;
      timeZone?: string;
    },
  ) {
    // Find matching recipients
    const recipientWhere: any = { organizationId };

    if (data.platformType) {
      recipientWhere.platform = { type: data.platformType };
    }

    if (data.filterTags && data.filterTags.length > 0) {
      recipientWhere.customerTags = {
        some: { tagId: { in: data.filterTags } },
      };
    }

    const customers = await this.prisma.customer.findMany({
      where: recipientWhere,
      include: {
        platform: { select: { id: true, type: true } },
      },
    });

    const broadcast = await this.prisma.broadcast.create({
      data: {
        organizationId,
        name: data.name,
        message: data.message,
        imageUrl: data.imageUrl,
        platformType: data.platformType,
        filterTags: data.filterTags as any,
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
        timeZone: data.timeZone || 'Asia/Bangkok',
        totalRecipients: customers.length,
        createdBy: userId,
        status: data.scheduledAt
          ? BroadcastStatus.scheduled
          : BroadcastStatus.draft,
        recipients: {
          create: customers.map((c) => ({
            customerId: c.id,
            platformId: c.platformId,
            status: BroadcastRecipientStatus.pending,
          })),
        },
      } as any,
      include: {
        _count: { select: { recipients: true } },
      },
    });

    return broadcast;
  }

  /**
   * Check for scheduled broadcasts every minute
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async checkScheduledBroadcasts() {
    this.logger.log('Checking for scheduled broadcasts...');

    try {
      const scheduledBroadcasts = await this.prisma.broadcast.findMany({
        where: {
          status: BroadcastStatus.scheduled,
          scheduledAt: { not: null },
        },
      });

      const now = new Date();

      for (const broadcast of scheduledBroadcasts) {
        if (!broadcast.scheduledAt) continue;

        if (now >= broadcast.scheduledAt) {
          this.logger.log(
            `Triggering scheduled broadcast: ${broadcast.name} (${broadcast.id})`,
          );

          await this.prisma.broadcast.update({
            where: { id: broadcast.id },
            data: { status: BroadcastStatus.sending },
          });
        }
      }
    } catch (error) {
      this.logger.error('Error checking scheduled broadcasts:', error);
    }
  }

  /**
   * Process pending broadcast recipients in batches.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async processBroadcastQueue() {
    if (this.isProcessingQueue) {
      this.logger.warn(
        'Broadcast queue processor is already running; skipping this tick.',
      );
      return;
    }

    this.isProcessingQueue = true;

    try {
      const recipients = await this.prisma.broadcastRecipient.findMany({
        where: {
          status: BroadcastRecipientStatus.pending,
          broadcast: {
            status: BroadcastStatus.sending,
          },
        },
        include: {
          broadcast: {
            select: {
              id: true,
              organizationId: true,
              message: true,
              imageUrl: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        take: this.broadcastBatchSize,
      });

      for (const recipient of recipients) {
        await this.processQueuedRecipient(recipient);
      }

      await this.checkBroadcastCompletion();
    } catch (error: any) {
      this.logger.error('Broadcast queue processing crashed', error);
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Send a broadcast immediately
   */
  async sendBroadcast(organizationId: string, broadcastId: string) {
    const broadcast = await this.prisma.broadcast.findFirst({
      where: { id: broadcastId, organizationId },
    });

    if (!broadcast) {
      throw new NotFoundException('Broadcast not found');
    }

    if (
      broadcast.status === BroadcastStatus.sent ||
      broadcast.status === BroadcastStatus.sending
    ) {
      throw new BadRequestException('Broadcast already sent or sending');
    }

    await this.prisma.broadcast.update({
      where: { id: broadcastId },
      data: { status: BroadcastStatus.sending },
    });

    return { message: 'Broadcast sending started', broadcastId };
  }

  private async processQueuedRecipient(recipient: {
    id: string;
    broadcastId: string;
    customerId: string;
    platformId: string;
    broadcast: {
      id: string;
      organizationId: string;
      message: string;
      imageUrl: string | null;
    };
  }) {
    try {
      const customer = await this.prisma.customer.findUnique({
        where: { id: recipient.customerId },
      });

      const platform = await this.prisma.platform.findUnique({
        where: { id: recipient.platformId },
      });

      if (!customer || !platform) {
        throw new Error('Missing customer or platform data');
      }

      let platformMessageId: string | undefined;

      if (platform.type === 'facebook') {
        platformMessageId = await this.messagingService.sendFacebookMessage(
          platform,
          customer.externalId,
          recipient.broadcast.message,
          recipient.broadcast.imageUrl || undefined,
        );
      } else if (platform.type === 'instagram') {
        platformMessageId = await this.messagingService.sendInstagramMessage(
          platform,
          customer.externalId,
          recipient.broadcast.message,
          recipient.broadcast.imageUrl || undefined,
        );
      } else if (platform.type === 'whatsapp') {
        platformMessageId = await this.messagingService.sendWhatsAppMessage(
          platform,
          customer.externalId,
          recipient.broadcast.message,
          recipient.broadcast.imageUrl || undefined,
        );
      } else {
        throw new Error(`Unsupported platform type: ${platform.type}`);
      }

      let conversation = await this.prisma.conversation.findFirst({
        where: {
          organizationId: recipient.broadcast.organizationId,
          platformId: platform.id,
          customerId: customer.id,
        },
      });

      if (!conversation) {
        conversation = await this.prisma.conversation.create({
          data: {
            organizationId: recipient.broadcast.organizationId,
            platformId: platform.id,
            customerId: customer.id,
            status: 'OPEN',
            lastMessageAt: new Date(),
          },
        });
      }

      const savedMessage = await this.prisma.message.create({
        data: {
          organizationId: recipient.broadcast.organizationId,
          conversationId: conversation.id,
          senderType: 'agent',
          content: recipient.broadcast.message,
          contentType: recipient.broadcast.imageUrl ? 'image' : 'text',
          imageUrl: recipient.broadcast.imageUrl || null,
          platformMessageId,
        },
      });

      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      });

      this.realtime.emitNewMessage(
        recipient.broadcast.organizationId,
        conversation.id,
        savedMessage,
      );

      await this.prisma.broadcastRecipient.update({
        where: { id: recipient.id },
        data: {
          status: BroadcastRecipientStatus.sent,
          sentAt: new Date(),
          error: null,
        },
      });

      await this.prisma.broadcast.update({
        where: { id: recipient.broadcastId },
        data: {
          sentCount: { increment: 1 },
        },
      });
    } catch (error: any) {
      this.logger.error(
        `Failed to send broadcast to recipient ${recipient.id}:`,
        error,
      );

      await this.prisma.broadcastRecipient.update({
        where: { id: recipient.id },
        data: {
          status: BroadcastRecipientStatus.failed,
          error: error?.message || 'Unknown error',
        },
      });

      await this.prisma.broadcast.update({
        where: { id: recipient.broadcastId },
        data: {
          failedCount: { increment: 1 },
        },
      });
    }
  }

  private async checkBroadcastCompletion() {
    const sendingBroadcasts = await this.prisma.broadcast.findMany({
      where: { status: BroadcastStatus.sending },
      select: { id: true },
    });

    for (const broadcast of sendingBroadcasts) {
      const pendingCount = await this.prisma.broadcastRecipient.count({
        where: {
          broadcastId: broadcast.id,
          status: BroadcastRecipientStatus.pending,
        },
      });

      if (pendingCount > 0) {
        continue;
      }

      const [sentCount, failedCount] = await Promise.all([
        this.prisma.broadcastRecipient.count({
          where: {
            broadcastId: broadcast.id,
            status: BroadcastRecipientStatus.sent,
          },
        }),
        this.prisma.broadcastRecipient.count({
          where: {
            broadcastId: broadcast.id,
            status: BroadcastRecipientStatus.failed,
          },
        }),
      ]);

      const processedCount = sentCount + failedCount;
      const failureRate =
        processedCount === 0 ? 0 : (failedCount / processedCount) * 100;

      const finalStatus =
        processedCount > 0 &&
        failureRate >= this.broadcastFailureThresholdPercent
          ? BroadcastStatus.failed
          : BroadcastStatus.sent;

      await this.prisma.broadcast.update({
        where: { id: broadcast.id },
        data: {
          status: finalStatus,
          sentAt: new Date(),
          sentCount,
          failedCount,
        },
      });

      this.logger.log(
        `Broadcast ${broadcast.id} completed: ${sentCount} sent, ${failedCount} failed`,
      );
    }
  }

  /**
   * Delete a draft broadcast
   */
  async deleteBroadcast(organizationId: string, broadcastId: string) {
    const broadcast = await this.prisma.broadcast.findFirst({
      where: { id: broadcastId, organizationId },
    });

    if (!broadcast) {
      throw new NotFoundException('Broadcast not found');
    }

    if (broadcast.status === 'sending') {
      throw new BadRequestException(
        'Cannot delete a broadcast that is currently sending',
      );
    }

    await this.prisma.$transaction([
      this.prisma.broadcastRecipient.deleteMany({
        where: { broadcastId },
      }),
      this.prisma.broadcast.delete({ where: { id: broadcastId } }),
    ]);
    return { message: 'Broadcast deleted successfully' };
  }

  async updateBroadcast(
    organizationId: string,
    broadcastId: string,
    data: {
      name?: string;
      message?: string;
      imageUrl?: string;
      platformType?: string;
      filterTags?: string[];
      scheduledAt?: string;
      timeZone?: string;
    },
  ) {
    const broadcast = await this.prisma.broadcast.findFirst({
      where: { id: broadcastId, organizationId },
    });

    if (!broadcast) {
      throw new NotFoundException('Broadcast not found');
    }

    if (
      broadcast.status === BroadcastStatus.sending ||
      broadcast.status === BroadcastStatus.sent
    ) {
      throw new BadRequestException(
        'Cannot edit a broadcast that is already sending or sent',
      );
    }

    const updated = await this.prisma.broadcast.update({
      where: { id: broadcastId },
      data: {
        name: data.name ?? broadcast.name,
        message: data.message ?? broadcast.message,
        imageUrl: data.imageUrl ?? broadcast.imageUrl,
        platformType: data.platformType ?? broadcast.platformType,
        filterTags: data.filterTags ?? broadcast.filterTags,
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
        timeZone: data.timeZone ?? broadcast.timeZone,
        status: data.scheduledAt
          ? BroadcastStatus.scheduled
          : BroadcastStatus.draft,
      } as any,
      include: {
        _count: { select: { recipients: true } },
      },
    });

    return updated;
  }

  async pauseBroadcast(organizationId: string, broadcastId: string) {
    const broadcast = await this.prisma.broadcast.findFirst({
      where: { id: broadcastId, organizationId },
    });

    if (!broadcast) throw new NotFoundException('Broadcast not found');

    if (broadcast.status !== BroadcastStatus.scheduled) {
      throw new BadRequestException('Only scheduled broadcasts can be paused');
    }

    return this.prisma.broadcast.update({
      where: { id: broadcastId },
      data: { status: BroadcastStatus.paused },
    });
  }

  async resumeBroadcast(organizationId: string, broadcastId: string) {
    const broadcast = await this.prisma.broadcast.findFirst({
      where: { id: broadcastId, organizationId },
    });

    if (!broadcast) throw new NotFoundException('Broadcast not found');

    if (broadcast.status !== BroadcastStatus.paused) {
      throw new BadRequestException('Only paused broadcasts can be resumed');
    }

    return this.prisma.broadcast.update({
      where: { id: broadcastId },
      data: { status: BroadcastStatus.scheduled },
    });
  }
}
