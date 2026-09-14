import { NotificationType, ScanMode, ScanStatus, Severity } from '@prisma/client';
import { ScanRunner } from './scan-runner';

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
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ finding: { deleteMany, createMany } })),
    };
    const runner = new ScanRunner(prisma as never, { status: 'ready', publish: jest.fn() } as never);
    await (runner as unknown as { persist: Function }).persist('ws_1', 'asset_1', 'scan_1', [
      { title: 'A', description: 'd', severity: Severity.LOW, confidence: 'HIGH', category: 'HTTP', evidence: 'e', recommendation: 'r' },
    ]);
    expect(deleteMany).toHaveBeenCalledWith({ where: { scanId: 'scan_1' } });
    expect(createMany).toHaveBeenCalled();
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
    await (runner as unknown as { complete: Function }).complete('scan_1', 70, [], 1);
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
    expect(NotificationType.SCAN_COMPLETED).toBe('SCAN_COMPLETED');
  });
});
