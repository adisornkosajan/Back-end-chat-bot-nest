
import { Test, TestingModule } from '@nestjs/testing';
import { FlowSchedulerService } from './src/modules/chatbot-flows/flow-scheduler.service';
import { FlowEngineService } from './src/modules/chatbot-flows/flow-engine.service';
import { PrismaService } from './src/prisma/prisma.service';
import { MessagingService } from './src/modules/messaging/messaging.service';
import { Logger } from '@nestjs/common';

// Mock MessagingService
const mockMessagingService = {
  sendFlowMessages: jest.fn().mockResolvedValue(undefined),
};

// Mock FlowEngineService
const mockFlowEngineService = {
  continueFlow: jest.fn().mockResolvedValue({ messages: [{ text: 'Resumed flow message' }] }),
};

// Mock PrismaService
const mockPrismaService = {
  conversation: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

async function runVerification() {
  const logger = new Logger('Verification');
  logger.log('Starting FlowScheduler Verification...');

  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      FlowSchedulerService,
      { provide: PrismaService, useValue: mockPrismaService },
      { provide: FlowEngineService, useValue: mockFlowEngineService },
      { provide: MessagingService, useValue: mockMessagingService },
    ],
  }).compile();

  const scheduler = moduleRef.get<FlowSchedulerService>(FlowSchedulerService);

  // Setup mock data
  const pastDate = new Date(Date.now() - 10000);
  const dueConversations = [
    {
      id: 'conv-123',
      activeFlowId: 'flow-abc',
      activeFlowNodeId: 'node-xyz',
      flowResumeAt: pastDate,
    },
  ];

  (mockPrismaService.conversation.findMany as jest.Mock).mockResolvedValue(dueConversations);
  
  // Execute
  await scheduler.checkDelayedFlows();

  // Verify
  logger.log('Verifying Prisma findMany call...');
  const findCalls = (mockPrismaService.conversation.findMany as jest.Mock).mock.calls;
  if (findCalls.length > 0) {
      logger.log('✅ Prisma.findMany called correctly.');
  } else {
      logger.error('❌ Prisma.findMany NOT called.');
  }

  logger.log('Verifying Prisma update call (clearing resume time)...');
  const updateCalls = (mockPrismaService.conversation.update as jest.Mock).mock.calls;
  if (updateCalls.length > 0 && updateCalls[0][0].where.id === 'conv-123' && updateCalls[0][0].data.flowResumeAt === null) {
      logger.log('✅ Prisma.update called to clear flowResumeAt.');
  } else {
      logger.error('❌ Prisma.update NOT called correctly.');
  }

  logger.log('Verifying FlowEngine.continueFlow call...');
  const continueCalls = (mockFlowEngineService.continueFlow as jest.Mock).mock.calls;
  if (continueCalls.length > 0 && continueCalls[0][0] === 'conv-123') {
      logger.log('✅ FlowEngine.continueFlow called with correct ID.');
  } else {
      logger.error('❌ FlowEngine.continueFlow NOT called.');
  }

  logger.log('Verifying MessagingService.sendFlowMessages call...');
  const msgCalls = (mockMessagingService.sendFlowMessages as jest.Mock).mock.calls;
  if (msgCalls.length > 0 && msgCalls[0][0] === 'conv-123' && msgCalls[0][1][0].text === 'Resumed flow message') {
      logger.log('✅ MessagingService.sendFlowMessages called with correct args.');
  } else {
      logger.error('❌ MessagingService.sendFlowMessages NOT called.');
  }
}

runVerification().catch(err => console.error(err));
