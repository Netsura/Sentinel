import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getRequestIp } from './request-context';

export type AuditEntry = {
  workspaceId: string;
  userId: string;
  action: string;
  resource: string;
  resourceId?: string;
  metadata?: Prisma.InputJsonValue;
};

/** Runs the mutation and the audit row in one transaction so a failed write cannot leave an unaudited change. */
export async function withAudit<T>(prisma: PrismaService, entry: AuditEntry, work: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    const result = await work(tx);
    const inferredId = result && typeof result === 'object' && 'id' in result ? String((result as { id: string }).id) : undefined;
    await tx.auditLog.create({
      data: {
        workspaceId: entry.workspaceId,
        userId: entry.userId,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId ?? inferredId,
        metadata: entry.metadata,
        ipAddress: getRequestIp(),
      },
    });
    return result;
  });
}
