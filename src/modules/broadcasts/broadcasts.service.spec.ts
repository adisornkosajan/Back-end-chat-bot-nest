import { Test, TestingModule } from '@nestjs/testing';
import { BroadcastsService } from './broadcasts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MessagingService } from '../messaging/messaging.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { toZonedTime } from 'date-fns-tz';

describe('BroadcastsService', () => {
  let service: BroadcastsService;
  let prisma: any;

  const mockPrismaService = {
    broadcast: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    customer: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    platform: {
      findUnique: jest.fn(),
    },
    conversation: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    message: {
      create: jest.fn(),
    },
    broadcastRecipient: {
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockMessagingService = {
    sendFacebookMessage: jest.fn(),
    sendInstagramMessage: jest.fn(),
    sendWhatsAppMessage: jest.fn(),
  };

  const mockRealtimeGateway = {
    emitNewMessage: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BroadcastsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: MessagingService, useValue: mockMessagingService },
        { provide: RealtimeGateway, useValue: mockRealtimeGateway },
      ],
    }).compile();

    service = module.get<BroadcastsService>(BroadcastsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createBroadcast', () => {
    it('should create a broadcast with default timezone', async () => {
      const data = {
        name: 'Test Broadcast',
        message: 'Hello',
      };
      const userId = 'user_1';
      const orgId = 'org_1';

      mockPrismaService.customer.findMany.mockResolvedValue([]);
      mockPrismaService.broadcast.create.mockResolvedValue({ id: 'b_1', ...data, timeZone: 'Asia/Bangkok' });

      await service.createBroadcast(orgId, userId, data);

      expect(prisma.broadcast.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
            timeZone: 'Asia/Bangkok'
        })
      }));
    });

    it('should create a broadcast with specified timezone', async () => {
      const data = {
        name: 'Test Broadcast',
        message: 'Hello',
        timeZone: 'America/New_York'
      };
      const userId = 'user_1';
      const orgId = 'org_1';

      mockPrismaService.customer.findMany.mockResolvedValue([]);
      mockPrismaService.broadcast.create.mockResolvedValue({ id: 'b_1', ...data });

      await service.createBroadcast(orgId, userId, data);

      expect(prisma.broadcast.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
            timeZone: 'America/New_York'
        })
      }));
    });
  });

  describe('checkScheduledBroadcasts', () => {
    it('should trigger broadcast if time matches', async () => {
      const pendingBroadcast = {
        id: 'b_1',
        organizationId: 'org_1',
        name: 'Scheduled',
        status: 'scheduled',
        scheduledAt: new Date(Date.now() - 1000), // Scheduled 1 second ago
        timeZone: 'Asia/Bangkok',
        message: 'test'
      };

      prisma.broadcast.findMany.mockResolvedValue([pendingBroadcast]);
      prisma.broadcast.findFirst.mockResolvedValue(pendingBroadcast); // For processBroadcastSending
      prisma.broadcastRecipient.findMany.mockResolvedValue([]); // No recipients for this test
      prisma.broadcast.update.mockResolvedValue(pendingBroadcast);

      await service.checkScheduledBroadcasts();

      expect(prisma.broadcast.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'b_1' },
        data: { status: 'sending' }
      }));
    });

    it('should NOT trigger broadcast if scheduled time is in future', async () => {
      const futureBroadcast = {
        id: 'b_2',
        organizationId: 'org_1',
        name: 'Future',
        status: 'scheduled',
        scheduledAt: new Date(Date.now() + 100000), // Scheduled in future
        timeZone: 'Asia/Bangkok',
      };

      prisma.broadcast.findMany.mockResolvedValue([futureBroadcast]);

      await service.checkScheduledBroadcasts();

      expect(prisma.broadcast.update).not.toHaveBeenCalled();
    });
  });
});
