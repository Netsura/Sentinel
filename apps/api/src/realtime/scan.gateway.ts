import { OnModuleDestroy, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import Redis from 'ioredis';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';

export type ScanProgressEvent = { scanId: string; workspaceId?: string; stage: string; progress: number };

@WebSocketGateway({ namespace: 'scans', cors: { origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' } })
export class ScanGateway implements OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private readonly subscriber = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { lazyConnect: true });

  constructor(private readonly jwt: JwtService, private readonly prisma: PrismaService) {}

  async onModuleInit() {
    try {
      await this.subscriber.connect();
      await this.subscriber.subscribe('scan.progress');
      this.subscriber.on('message', (_channel, raw) => {
        const event = JSON.parse(raw) as ScanProgressEvent;
        this.server.to(`scan:${event.scanId}`).emit('scan.progress', event);
      });
    } catch {
      // Redis may be unavailable while the API is starting; queued scans report through HTTP until it recovers.
    }
  }

  async onModuleDestroy() {
    if (this.subscriber.status !== 'end') await this.subscriber.quit();
  }

  @SubscribeMessage('scan.subscribe')
  async subscribe(client: Socket, payload: { token?: string; scanId?: string }) {
    if (!payload?.token || !payload.scanId) throw new UnauthorizedException('Token and scan ID are required');
    const claims = await this.jwt.verifyAsync<{ sub?: string }>(payload.token).catch(() => { throw new UnauthorizedException('Invalid WebSocket token'); });
    const scan = await this.prisma.scan.findFirst({ where: { id: payload.scanId, workspace: { members: { some: { userId: claims.sub } } } }, select: { id: true } });
    if (!scan) throw new UnauthorizedException('Scan is not available in this workspace');
    await client.join(`scan:${scan.id}`);
    return { event: 'scan.subscribed', data: { scanId: scan.id } };
  }
}
