import { NotificationType, ScanMode, ScanStatus, Severity } from '@prisma/client';
import { ScanRunner } from './scan-runner';

type RunnerInternals = {
  persist: (workspaceId: string, assetId: string, scanId: string, findings: unknown[]) => Promise<number>;
  complete: (scanId: string, score: number, findings: unknown[], requests: number, resolvedCount?: number) => Promise<void>;
  begin: (scanId: string, startedAt: Date | null) => Promise<void>;
};

function internals(runner: ScanRunner) {
  return runner as unknown as RunnerInternals;
}

describe('ScanRunner idempotency', () => {
  it('skips work when the scan is already completed', async () => {
    const prisma = {
      scan: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'scan_1',
          assetId: 'asset_1',
          status: ScanStatus.COMPLETED,
          score: 88,
          mode: ScanMode.SAFE,
          asset: { value: 'example.com', type: 'DOMAIN' },
        }),
      },
    };
    const runner = new ScanRunner(prisma as never, { status: 'ready', publish: jest.fn() } as never);
    await expect(runner.run({ scanId: 'scan_1', workspaceId: 'ws_1', assetId: 'asset_1', mode: ScanMode.SAFE })).resolves.toEqual({
      score: 88,
      findings: 0,
      requests: 0,
      skipped: true,
    });
  });

  it('replaces findings for the same scan instead of appending', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 2 });
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      finding: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ finding: { deleteMany, createMany, updateMany } })),
    };
    const runner = new ScanRunner(prisma as never, { status: 'ready', publish: jest.fn() } as never);
    await internals(runner).persist('ws_1', 'asset_1', 'scan_1', [
      { title: 'A', description: 'd', severity: Severity.LOW, confidence: 'HIGH', category: 'HTTP', evidence: 'e', recommendation: 'r' },
    ]);
    expect(deleteMany).toHaveBeenCalledWith({ where: { scanId: 'scan_1' } });
    expect(createMany).toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalled();
  });

  it('does not emit a second completion notification after a retry claims a completed scan', async () => {
    const prisma = {
      scan: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: jest.fn(),
      },
      notification: { createMany: jest.fn() },
    };
    const runner = new ScanRunner(prisma as never, { status: 'ready', publish: jest.fn() } as never);
    await internals(runner).complete('scan_1', 70, [], 1);
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
    expect(NotificationType.SCAN_COMPLETED).toBe('SCAN_COMPLETED');
  });

  it('does not overwrite a cancelled scan when beginning work', async () => {
    const prisma = {
      scan: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({ status: ScanStatus.CANCELLED }),
      },
    };
    const runner = new ScanRunner(prisma as never, { status: 'ready', publish: jest.fn() } as never);
    await expect(internals(runner).begin('scan_1', null)).rejects.toMatchObject({ name: 'ScanCancelledError' });
    expect(prisma.scan.updateMany).toHaveBeenCalledWith({
      where: { id: 'scan_1', status: { in: [ScanStatus.QUEUED, ScanStatus.RUNNING] } },
      data: expect.objectContaining({ status: ScanStatus.RUNNING }),
    });
  });

  it('returns after COMPLETED is claimed even if Redis publish never resolves', async () => {
    const prisma = {
      scan: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'scan_1',
          assetId: 'asset_1',
          workspaceId: 'ws_1',
          startedById: 'user_1',
          mode: ScanMode.SAFE,
          asset: { id: 'asset_1', value: 'example.com', securityScore: null },
        }),
      },
      asset: { update: jest.fn().mockResolvedValue({}) },
      notification: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const publisher = {
      status: 'wait',
      connect: () => new Promise(() => undefined),
      publish: jest.fn(),
    };
    const runner = new ScanRunner(prisma as never, publisher as never);
    await expect(internals(runner).complete('scan_1', 80, [], 2)).resolves.toBeUndefined();
    expect(prisma.asset.update).toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
  });
});
