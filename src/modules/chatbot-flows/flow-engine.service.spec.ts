import { Test, TestingModule } from '@nestjs/testing';
import { FlowEngineService } from './flow-engine.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('FlowEngineService', () => {
  let service: FlowEngineService;

  const mockPrismaService = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlowEngineService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<FlowEngineService>(FlowEngineService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('executeFlow', () => {
    const mockContext = {
      customerMessage: 'Hello World',
      customerId: 'cust_123',
      platform: { type: 'facebook' },
      conversationId: 'conv_123',
      organizationId: 'org_123',
    };

    it('should return empty result if no nodes provided', async () => {
      const result = await service.executeFlow({ nodes: [] }, mockContext);
      expect(result.responded).toBe(false);
      expect(result.messages).toEqual([]);
    });

    it('should process a simple message node', async () => {
      const flow = {
        nodes: [
          {
            id: 'node_1',
            type: 'message',
            data: { text: 'Welcome!' },
            nextNodeId: null,
          },
        ],
      };

      const result = await service.executeFlow(flow, mockContext);
      expect(result.responded).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].text).toBe('Welcome!');
    });

    it('should replace variables in message text', async () => {
      const flow = {
        nodes: [
          {
            id: 'node_1',
            type: 'message',
            data: { text: 'Hi {customer_id}, you said {customer_message}' },
            nextNodeId: null,
          },
        ],
      };

      const result = await service.executeFlow(flow, mockContext);
      expect(result.messages[0].text).toBe('Hi cust_123, you said Hello World');
    });

    it('should follow condition True path', async () => {
      const flow = {
        nodes: [
          {
            id: 'start',
            type: 'condition',
            data: {
              variable: 'message',
              operator: 'equals',
              value: 'Hello World',
            },
            conditionTrueNodeId: 'node_true',
            conditionFalseNodeId: 'node_false',
          },
          {
            id: 'node_true',
            type: 'message',
            data: { text: 'Matched!' },
            nextNodeId: null,
          },
          {
            id: 'node_false',
            type: 'message',
            data: { text: 'Not Matched!' },
            nextNodeId: null,
          },
        ],
      };

      const result = await service.executeFlow(flow, mockContext);
      expect(result.messages[0].text).toBe('Matched!');
    });

    it('should follow condition False path', async () => {
      const flow = {
        nodes: [
          {
            id: 'start',
            type: 'condition',
            data: {
              variable: 'message',
              operator: 'equals',
              value: 'Goodbye',
            },
            conditionTrueNodeId: 'node_true',
            conditionFalseNodeId: 'node_false',
          },
          {
            id: 'node_true',
            type: 'message',
            data: { text: 'Matched!' },
            nextNodeId: null,
          },
          {
            id: 'node_false',
            type: 'message',
            data: { text: 'Not Matched!' },
            nextNodeId: null,
          },
        ],
      };

      const result = await service.executeFlow(flow, mockContext);
      expect(result.messages[0].text).toBe('Not Matched!');
    });

    it('should handle loop prevention (max steps)', async () => {
      const flow = {
        nodes: [
          {
            id: 'node_1',
            type: 'message',
            data: { text: 'Loop' },
            nextNodeId: 'node_1', // Point to itself
          },
        ],
      };

      const result = await service.executeFlow(flow, mockContext);
      // It should produce messages up to maxSteps (50)
      expect(result.messages.length).toBe(50);
    });

    it('should handle location nodes', async () => {
        const flow = {
          nodes: [
            {
              id: 'node_loc',
              type: 'location',
              data: { 
                  latitude: 13.7563, 
                  longitude: 100.5018,
                  locationName: 'Bangkok' 
              },
              nextNodeId: null,
            },
          ],
        };
  
        const result = await service.executeFlow(flow, mockContext);
        expect(result.responded).toBe(true);
        expect(result.messages[0].location).toBeDefined();
        expect(result.messages[0].location?.name).toBe('Bangkok');
      });
  });
});
