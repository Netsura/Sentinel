import { ScanMode } from '@prisma/client';
import { resolveScanJob, ScheduledJobData } from './scan-jobs';

describe('resolveScanJob', () => {
  it('returns the existing payload for a manual scan job', async () => {
    const data = { scanId: 'scan_1', workspaceId: 'ws_1', assetId: 'asset_1', mode: ScanMode.SAFE };
    await expect(resolveScanJob({} as never, { name: 'scan', data } as never)).resolves.toEqual(data);
  });

  it('reuses scanId already stored on a scheduled job', async () => {
    const data: ScheduledJobData = { scheduleId: 'sch_1', workspaceId: 'ws_1', assetId: 'asset_1', mode: ScanMode.NORMAL, scanId: 'scan_9' };
    const prisma = { scan: { findUnique: jest.fn().mockResolvedValue({ id: 'scan_9', workspaceId: 'ws_1', assetId: 'asset_1', mode: ScanMode.NORMAL }) } };
    await expect(resolveScanJob(prisma as never, { name: 'scheduled-scan', data, updateData: jest.fn() } as never)).resolves.toEqual({
      scanId: 'scan_9',
      workspaceId: 'ws_1',
      assetId: 'asset_1',
      mode: ScanMode.NORMAL,
    });
  });

  it('reuses an in-flight scan for the schedule instead of creating a second row', async () => {
    const updateData = jest.fn().mockResolvedValue(undefined);
    const data: ScheduledJobData = { scheduleId: 'sch_1', workspaceId: 'ws_1', assetId: 'asset_1', mode: ScanMode.SAFE };
    const inflight = { id: 'scan_existing', workspaceId: 'ws_1', assetId: 'asset_1', mode: ScanMode.SAFE };
    const prisma = {
      $transaction: async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => fn({
        scheduledScan: { findUnique: jest.fn().mockResolvedValue({ id: 'sch_1', enabled: true, frequency: 'DAILY' }), update: jest.fn() },
        scan: { findFirst: jest.fn().mockResolvedValue(inflight), create: jest.fn() },
      }),
    };

    const result = await resolveScanJob(prisma as never, { name: 'scheduled-scan', data, updateData } as never);
    expect(result?.scanId).toBe('scan_existing');
    expect(updateData).toHaveBeenCalled();
  });

  it('skips a disabled schedule', async () => {
    const prisma = {
      $transaction: async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => fn({
        scheduledScan: { findUnique: jest.fn().mockResolvedValue({ id: 'sch_1', enabled: false }) },
        scan: { findFirst: jest.fn() },
      }),
    };
    await expect(resolveScanJob(prisma as never, { name: 'scheduled-scan', data: { scheduleId: 'sch_1' }, updateData: jest.fn() } as never)).resolves.toBeNull();
  });
});
