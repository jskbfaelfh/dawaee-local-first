import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';
import { isOriginAllowed } from '../../common/utils/security.util';

@WebSocketGateway({
  namespace: '/realtime',
  cors: {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin || isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`WebSocket origin ${origin} not allowed by CORS`), false);
      }
    },
    credentials: true,
  },
})
export class PharmacyEventsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(PharmacyEventsGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      // SECURITY: Reject tokens passed in URL query string to prevent leakage in logs, proxies, and history
      if (client.handshake.query?.token) {
        this.logger.warn(
          `Security violation: Client ${client.id} attempted to pass JWT in query parameter. Query tokens are strictly prohibited.`,
        );
        client.disconnect(true);
        return;
      }

      // Safe token sources:
      // 1. Socket.IO handshake auth: client.handshake.auth?.token
      // 2. HTTP Authorization Header: client.handshake.headers.authorization
      // 3. HttpOnly Cookie: dawaee_token or token
      let token = client.handshake.auth?.token;
      if (!token && client.handshake.headers.authorization) {
        token = client.handshake.headers.authorization.replace(/^Bearer\s+/i, '').trim();
      }
      if (!token && client.handshake.headers.cookie) {
        const cookies = client.handshake.headers.cookie.split(';').map((c) => c.trim());
        for (const cookie of cookies) {
          if (cookie.startsWith('dawaee_token=')) {
            token = cookie.slice('dawaee_token='.length);
            break;
          }
          if (cookie.startsWith('token=')) {
            token = cookie.slice('token='.length);
            break;
          }
        }
      }

      if (!token) {
        this.logger.warn(`Client ${client.id} connected without token, disconnecting.`);
        client.disconnect(true);
        return;
      }

      const decoded: any = this.jwtService.verify(token as string);
      if (!decoded || !decoded.tenantId) {
        client.disconnect(true);
        return;
      }

      const roomName = `tenant_${decoded.tenantId}`;
      client.join(roomName);
      (client as any).tenantId = decoded.tenantId;
      (client as any).userId = decoded.sub;

      this.logger.log(`Client ${client.id} joined room ${roomName}`);
    } catch (err: any) {
      this.logger.warn(`Auth failed for socket ${client.id}: ${err.message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /**
   * Broadcast inventory updates to all cashiers in the same pharmacy
   */
  @OnEvent('inventory.synced')
  handleInventorySynced(payload: { tenantId: string; schemaName: string; medicineIds?: string[] }) {
    if (!payload.tenantId || !this.server) return;
    const roomName = `tenant_${payload.tenantId}`;
    this.server.to(roomName).emit('STOCK_UPDATED', {
      timestamp: new Date().toISOString(),
      medicineIds: payload.medicineIds || [],
    });
  }

  /**
   * Broadcast sale completed event
   */
  @OnEvent('sale.completed')
  handleSaleCompleted(payload: { tenantId: string; schemaName: string; sale: any }) {
    if (!payload.tenantId || !this.server) return;
    const roomName = `tenant_${payload.tenantId}`;
    this.server.to(roomName).emit('SALE_COMPLETED', {
      timestamp: new Date().toISOString(),
      sale: payload.sale,
    });
  }

  /**
   * Broadcast bulk stock entry event
   */
  @OnEvent('stock.entered')
  handleStockEntered(payload: { tenantId: string; schemaName: string; count: number }) {
    if (!payload.tenantId || !this.server) return;
    const roomName = `tenant_${payload.tenantId}`;
    this.server.to(roomName).emit('STOCK_ENTERED', {
      timestamp: new Date().toISOString(),
      count: payload.count,
    });
  }
}
