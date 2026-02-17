import { Test, TestingModule } from '@nestjs/testing';
import { RealtimeGateway } from './realtime.gateway';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;
  let jwtService: any;

  const mockJwtService = {
    verify: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    gateway = module.get<RealtimeGateway>(RealtimeGateway);
    
    // Mock the WebSocket Server
    gateway.server = {
        to: jest.fn().mockReturnThis(),
        emit: jest.fn(),
        sockets: {
            adapter: { rooms: new Map() },
            sockets: new Map()
        }
    } as any;
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('handleConnection', () => {
    let mockClient: any;

    beforeEach(() => {
      mockClient = {
        id: 'socket_1',
        handshake: {
          auth: {},
          headers: {},
        },
        join: jest.fn(),
        disconnect: jest.fn(),
        data: {},
      };
    });

    it('should disconnect if no token provided', () => {
      gateway.handleConnection(mockClient);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it('should verify token and join room', () => {
      mockClient.handshake.auth.token = 'valid_token';
      mockJwtService.verify.mockReturnValue({
        organizationId: 'org_123',
        sub: 'user_123',
      });

      gateway.handleConnection(mockClient);

      expect(mockJwtService.verify).toHaveBeenCalledWith('valid_token');
      expect(mockClient.join).toHaveBeenCalledWith('org:org_123');
      expect(mockClient.data.user).toBeDefined();
    });

    it('should disconnect on invalid token', () => {
      mockClient.handshake.auth.token = 'invalid_token';
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      gateway.handleConnection(mockClient);

      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe('emitNewMessage', () => {
    it('should emit message:new event to correct room', () => {
      const orgId = 'org_123';
      const convId = 'conv_123';
      const payload = { id: 'msg_1', content: 'hello' };

      gateway.emitNewMessage(orgId, convId, payload);

      expect(gateway.server.to).toHaveBeenCalledWith('org:org_123');
      expect(gateway.server.emit).toHaveBeenCalledWith('message:new', {
        conversationId: convId,
        message: payload,
      });
    });
  });
});
