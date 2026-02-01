import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({
  namespace: '/',
  cors: {
    origin: '*',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor(private readonly jwtService: JwtService) {
    console.log('✅ RealtimeGateway initialized');
  }

  afterInit(server: Server) {
    console.log('🚀 WebSocket Gateway initialized and ready');
    console.log('📡 Socket.IO Server:', server ? 'OK' : 'ERROR');
    console.log('🔧 Listening for connections...');
    
    // Add middleware to log all connection attempts
    server.use((socket, next) => {
      console.log('═══════════════════════════════════════');
      console.log('🔍 Middleware - NEW Connection Attempt!');
      console.log('Socket ID:', socket.id);
      console.log('Headers:', JSON.stringify(socket.handshake.headers, null, 2));
      console.log('Auth:', JSON.stringify(socket.handshake.auth, null, 2));
      console.log('Query:', JSON.stringify(socket.handshake.query, null, 2));
      console.log('═══════════════════════════════════════');
      next();
    });

    // Log when server receives any event
    server.on('connection', (socket) => {
      console.log('⚡ RAW CONNECTION EVENT FIRED! Socket ID:', socket.id);
    });
  }

  handleConnection(client: Socket) {
    console.log('🔌 Client attempting to connect:', client.id);
    console.log('Headers:', JSON.stringify(client.handshake.headers));
    console.log('Auth:', JSON.stringify(client.handshake.auth));
    
    let token = client.handshake.auth?.token;
    
    // Try to get token from various sources
    if (!token && client.handshake.headers?.authorization) {
      const authHeader = client.handshake.headers.authorization;
      if (typeof authHeader === 'string') {
        token = authHeader.replace('Bearer ', '').replace('<', '').replace('>', '').trim();
      }
    }
    
    if (!token) {
      console.log('❌ No token provided, disconnecting:', client.id);
      client.disconnect();
      return;
    }

    console.log('🔑 Token received:', token.substring(0, 20) + '...');

    try {
      const payload = this.jwtService.verify(token);
      client.data.user = payload;
      const roomName = `org:${payload.organizationId}`;
      client.join(roomName);
      
      console.log('✅ Client connected:', client.id, 'Org:', payload.organizationId);
      console.log('🚪 Client joined room:', roomName);
      console.log('👤 User ID:', payload.sub);
      console.log('🎭 User Role:', payload.role);
      
      // Show all rooms this socket is in
      console.log('📍 Socket rooms:', Array.from(client.rooms));
    } catch (error) {
      console.log('❌ Token verification failed:', error.message);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    console.log('👋 Client disconnected:', client.id);
    client.removeAllListeners();
  }

  emitNewMessage(orgId: string, conversationId: string, payload: any) {
    console.log('═══════════════════════════════════════');
    console.log('📤 EMITTING message:new event');
    console.log('Organization ID:', orgId);
    console.log('Room:', `org:${orgId}`);
    console.log('Conversation ID:', conversationId);
    console.log('Message ID:', payload.id);
    
    // 🔍 Debug: Show all connected clients and their rooms (with null checks)
    if (this.server && this.server.sockets && this.server.sockets.adapter) {
      const room = this.server.sockets.adapter.rooms.get(`org:${orgId}`);
      console.log(`👥 Clients in room org:${orgId}:`, room ? room.size : 0);
      
      if (room) {
        console.log('📋 Socket IDs in room:', Array.from(room));
      }
      
      // Show all connected sockets
      const allSockets = Array.from(this.server.sockets.sockets.keys());
      console.log('🌐 Total connected sockets:', allSockets.length);
      console.log('📌 All socket IDs:', allSockets);
    } else {
      console.log('⚠️ Socket.IO server not fully initialized yet');
    }
    
    console.log('═══════════════════════════════════════');
    
    if (this.server) {
      this.server
        .to(`org:${orgId}`)
        .emit('message:new', {
          conversationId,
          message: payload,
        });
      
      console.log('✅ Event emitted successfully');
    } else {
      console.log('❌ Cannot emit: Socket.IO server not available');
    }
  }
}
