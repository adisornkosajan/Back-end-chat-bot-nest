import { Test, TestingModule } from '@nestjs/testing';
import { MessagingService } from './messaging.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AiService } from '../ai/ai.service';
import { PluginEngineService } from '../plugins/plugin-engine.service';
import { ChatbotFlowsService } from '../chatbot-flows/chatbot-flows.service';
import { FlowEngineService } from '../chatbot-flows/flow-engine.service';
import { AutoAssignRulesService } from '../auto-assign-rules/auto-assign-rules.service';

describe('MessagingService', () => {
  let service: MessagingService;
  let prisma: any;
  let realtime: any;
  let flowEngine: any;
  let chatbotFlows: any;

  // Mock Objects
  const mockPrismaService = {
    platform: {
      findFirst: jest.fn(),
    },
    customer: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    conversation: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    message: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const mockRealtimeGateway = {
    emitNewMessage: jest.fn(),
  };

  const mockAiService = {
    generateReply: jest.fn(),
  };

  const mockPluginEngineService = {
    runPlugins: jest.fn().mockResolvedValue(false),
  };

  const mockChatbotFlowsService = {
    findMatchingFlow: jest.fn(),
  };

  const mockFlowEngineService = {
    executeFlow: jest.fn(),
  };

  const mockAutoAssignRulesService = {
    evaluateRules: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagingService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RealtimeGateway, useValue: mockRealtimeGateway },
        { provide: AiService, useValue: mockAiService },
        { provide: PluginEngineService, useValue: mockPluginEngineService },
        { provide: ChatbotFlowsService, useValue: mockChatbotFlowsService },
        { provide: FlowEngineService, useValue: mockFlowEngineService },
        { provide: AutoAssignRulesService, useValue: mockAutoAssignRulesService },
      ],
    }).compile();

    service = module.get<MessagingService>(MessagingService);
    prisma = module.get(PrismaService);
    realtime = module.get(RealtimeGateway);
    flowEngine = module.get(FlowEngineService);
    chatbotFlows = module.get(ChatbotFlowsService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processInbound', () => {
    const mockPlatform = {
      id: 'plat_123',
      organizationId: 'org_123',
      type: 'facebook',
      pageId: 'page_123',
      isActive: true,
      accessToken: 'token',
    };

    const mockCustomer = {
      id: 'cust_123',
      organizationId: 'org_123',
      externalId: 'ext_cust_1',
    };

    const mockConversation = {
      id: 'conv_123',
      customerId: 'cust_123',
      organizationId: 'org_123',
      assignedAgentId: null,
    };

    const inboundData = {
      platform: 'facebook',
      recipientId: 'page_123',
      externalCustomerId: 'ext_cust_1',
      messageId: 'msg_123',
      content: 'Hello',
      contentType: 'text',
      raw: {},
    };

    it('should process inbound message successfully', async () => {
      // Setup Mocks
      prisma.platform.findFirst.mockResolvedValue(mockPlatform);
      prisma.customer.findFirst.mockResolvedValue(mockCustomer);
      prisma.conversation.findFirst.mockResolvedValue(mockConversation);
      prisma.message.findFirst.mockResolvedValue(null); // No duplicate
      prisma.message.create.mockResolvedValue({ id: 'db_msg_1', content: 'Hello' });
      
      // Auto-assign mock
      mockAutoAssignRulesService.evaluateRules.mockResolvedValue(null);
      
      // Flow mock (no match)
      chatbotFlows.findMatchingFlow.mockResolvedValue(null);

      // Execute
      await service.processInbound(inboundData);

      // Verify
      expect(prisma.platform.findFirst).toHaveBeenCalled();
      expect(prisma.message.create).toHaveBeenCalled();
      expect(realtime.emitNewMessage).toHaveBeenCalledWith(
        'org_123',
        'conv_123',
        expect.anything()
      );
    });

    it('should create new customer and conversation if not found', async () => {
      prisma.platform.findFirst.mockResolvedValue(mockPlatform);
      prisma.customer.findFirst.mockResolvedValue(null); // Customer Not Found
      prisma.customer.create.mockResolvedValue(mockCustomer);
      
      prisma.conversation.findFirst.mockResolvedValue(null); // Conversation Not Found
      prisma.conversation.create.mockResolvedValue(mockConversation);
      
      prisma.message.findFirst.mockResolvedValue(null);
      prisma.message.create.mockResolvedValue({ id: 'db_msg_1' });

      await service.processInbound(inboundData);

      expect(prisma.customer.create).toHaveBeenCalled();
      expect(prisma.conversation.create).toHaveBeenCalled();
    });

    it('should execute chatbot flow if match found', async () => {
      prisma.platform.findFirst.mockResolvedValue(mockPlatform);
      prisma.customer.findFirst.mockResolvedValue(mockCustomer);
      prisma.conversation.findFirst.mockResolvedValue(mockConversation);
      prisma.message.create.mockResolvedValue({ id: 'db_msg_1' });

      const mockFlow = { id: 'flow_1', name: 'Test Flow' };
      chatbotFlows.findMatchingFlow.mockResolvedValue(mockFlow);
      flowEngine.executeFlow.mockResolvedValue({
        responded: true,
        messages: [{ text: 'Bot Reply' }],
        actions: [],
      });

      // Mock prisma create for bot reply
      prisma.message.create.mockResolvedValueOnce({ id: 'db_msg_1' }) // User msg
                           .mockResolvedValueOnce({ id: 'bot_msg_1', senderType: 'agent' }); // Bot msg

      await service.processInbound(inboundData);

      expect(flowEngine.executeFlow).toHaveBeenCalledWith(
        mockFlow,
        expect.objectContaining({ customerMessage: 'Hello' })
      );
    });
  });
});
