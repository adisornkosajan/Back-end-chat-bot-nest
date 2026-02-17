import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MessagingService } from '../messaging/messaging.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Injectable()
export class BroadcastsService {
  private readonly logger = new Logger(BroadcastsService.name);

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
        totalRecipients: customers.length,
        createdBy: userId,
        status: data.scheduledAt ? 'scheduled' : 'draft',
        recipients: {
          create: customers.map((c) => ({
            customerId: c.id,
            platformId: c.platformId,
            status: 'pending',
          })),
        },
      },
      include: {
        _count: { select: { recipients: true } },
      },
    });

    return broadcast;
  }

  /**
   * Send a broadcast immediately
   */
  async sendBroadcast(organizationId: string, broadcastId: string) {
    const broadcast = await this.prisma.broadcast.findFirst({
      where: { id: broadcastId, organizationId },
      include: {
        recipients: {
          where: { status: 'pending' },
          include: {
            // We need platform and customer info
          },
        },
      },
    });

    if (!broadcast) {
      throw new NotFoundException('Broadcast not found');
    }

    if (broadcast.status === 'sent' || broadcast.status === 'sending') {
      throw new BadRequestException('Broadcast already sent or sending');
    }

    // Update status to sending
    await this.prisma.broadcast.update({
      where: { id: broadcastId },
      data: { status: 'sending' },
    });

    // Process in background (fire and forget)
    this.processBroadcastSending(broadcastId, organizationId).catch((err) => {
      this.logger.error(`Failed to process broadcast ${broadcastId}:`, err);
    });

    return { message: 'Broadcast sending started', broadcastId };
  }

  /**
   * Process sending broadcast messages
   */
  private async processBroadcastSending(
    broadcastId: string,
    organizationId: string,
  ) {
    let sentCount = 0;
    let failedCount = 0;
    try {
      const broadcast = await this.prisma.broadcast.findFirst({
        where: { id: broadcastId, organizationId },
      });

      if (!broadcast) {
        throw new NotFoundException('Broadcast not found');
      }

      const recipients = await this.prisma.broadcastRecipient.findMany({
        where: { broadcastId, status: 'pending' },
      });

      for (const recipient of recipients) {
        try {
          // Get customer and platform info
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

          // Send message based on platform type
          if (platform.type === 'facebook') {
            platformMessageId = await this.messagingService.sendFacebookMessage(
              platform,
              customer.externalId,
              broadcast.message,
              broadcast.imageUrl || undefined,
            );
          } else if (platform.type === 'instagram') {
            platformMessageId = await this.messagingService.sendInstagramMessage(
              platform,
              customer.externalId,
              broadcast.message,
              broadcast.imageUrl || undefined,
            );
          } else if (platform.type === 'whatsapp') {
            platformMessageId = await this.messagingService.sendWhatsAppMessage(
              platform,
              customer.externalId,
              broadcast.message,
              broadcast.imageUrl || undefined,
            );
          } else {
            throw new Error(`Unsupported platform type: ${platform.type}`);
          }

          // Persist outbound broadcast into conversation so it appears in Inbox/Conversation UI.
          let conversation = await this.prisma.conversation.findFirst({
            where: {
              organizationId,
              platformId: platform.id,
              customerId: customer.id,
            },
          });

          if (!conversation) {
            conversation = await this.prisma.conversation.create({
              data: {
                organizationId,
                platformId: platform.id,
                customerId: customer.id,
                status: 'OPEN',
                lastMessageAt: new Date(),
              },
            });
          }

          const savedMessage = await this.prisma.message.create({
            data: {
              organizationId,
              conversationId: conversation.id,
              senderType: 'agent',
              content: broadcast.message,
              contentType: broadcast.imageUrl ? 'image' : 'text',
              imageUrl: broadcast.imageUrl || null,
              platformMessageId,
            },
          });

          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: { lastMessageAt: new Date() },
          });

          this.realtime.emitNewMessage(
            organizationId,
            conversation.id,
            savedMessage,
          );

          // Update recipient status
          await this.prisma.broadcastRecipient.update({
            where: { id: recipient.id },
            data: { status: 'sent', sentAt: new Date(), error: null },
          });

          sentCount++;
        } catch (error: any) {
          this.logger.error(
            `Failed to send broadcast to recipient ${recipient.id}:`,
            error,
          );

          await this.prisma.broadcastRecipient.update({
            where: { id: recipient.id },
            data: {
              status: 'failed',
              error: error?.message || 'Unknown error',
            },
          });

          failedCount++;
        }

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      const finalStatus = sentCount > 0 ? 'sent' : 'failed';

      // Always finalize status so UI doesn't get stuck in "sending"
      await this.prisma.broadcast.update({
        where: { id: broadcastId },
        data: {
          status: finalStatus,
          sentAt: new Date(),
          sentCount,
          failedCount,
        },
      });

      this.logger.log(
        `✅ Broadcast ${broadcastId} completed: ${sentCount} sent, ${failedCount} failed`,
      );
    } catch (error: any) {
      this.logger.error(`❌ Broadcast ${broadcastId} crashed during sending`, error);

      // Mark any remaining pending recipients as failed and finalize broadcast.
      const pending = await this.prisma.broadcastRecipient.updateMany({
        where: { broadcastId, status: 'pending' },
        data: {
          status: 'failed',
          error: error?.message || 'Broadcast processing failed',
        },
      });

      failedCount += pending.count;

      await this.prisma.broadcast.update({
        where: { id: broadcastId },
        data: {
          status: 'failed',
          sentCount,
          failedCount,
        },
      });
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
      throw new BadRequestException('Cannot delete a broadcast that is currently sending');
    }

    await this.prisma.$transaction([
      this.prisma.broadcastRecipient.deleteMany({
        where: { broadcastId },
      }),
      this.prisma.broadcast.delete({ where: { id: broadcastId } }),
    ]);
    return { message: 'Broadcast deleted successfully' };
  }
}
