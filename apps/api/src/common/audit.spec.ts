import { withAudit } from './audit';

describe('withAudit', () => {
  it('writes the mutation and the audit row in the same transaction', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'log_1' });
    const prisma = {
      $transaction: jest.fn(async (work: (tx: { auditLog: { create: jest.Mock } }) => Promise<unknown>) => {
        return work({ auditLog: { create } });
      }),
    };

    const result = await withAudit(
      prisma as never,
      { workspaceId: 'ws_1', userId: 'user_1', action: 'ASSET_CREATED', resource: 'Asset' },
      async () => ({ id: 'asset_1', value: 'example.com' }),
    );

    expect(result).toEqual({ id: 'asset_1', value: 'example.com' });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: 'ws_1',
        userId: 'user_1',
        action: 'ASSET_CREATED',
        resource: 'Asset',
        resourceId: 'asset_1',
      }),
    });
  });
});
