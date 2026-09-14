import { BillingStatus } from '@prisma/client';
import { BillingService } from './billing.service';
import { StripeGateway, StripeWebhookEvent } from './stripe.gateway';

function event(partial: Partial<StripeWebhookEvent> & Pick<StripeWebhookEvent, 'id' | 'type'>): StripeWebhookEvent {
  return { livemode: false, data: { object: {} }, ...partial };
}

describe('BillingService.ingestEvent', () => {
  const workspaceId = 'ws_1';
  const prisma = {
    stripeEvent: { findUnique: jest.fn(), create: jest.fn() },
    workspace: { update: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const stripe = { enabled: () => true } as StripeGateway;
  const workspaces = { requireMembership: jest.fn() };
  let service: BillingService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
    service = new BillingService(prisma as never, workspaces as never, stripe);
  });

  it('is a no-op when the Stripe event id already exists', async () => {
    prisma.stripeEvent.findUnique.mockResolvedValue({ id: 'evt_1' });
    await expect(service.ingestEvent(event({ id: 'evt_1', type: 'invoice.paid' }))).resolves.toEqual({ received: true, duplicate: true });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('stores the event and applies checkout completion once', async () => {
    prisma.stripeEvent.findUnique.mockResolvedValue(null);
    prisma.stripeEvent.create.mockResolvedValue({ id: 'evt_2' });
    prisma.workspace.update.mockResolvedValue({ id: workspaceId });

    const result = await service.ingestEvent(event({
      id: 'evt_2',
      type: 'checkout.session.completed',
      data: { object: { client_reference_id: workspaceId, customer: 'cus_1', subscription: 'sub_1' } },
    }));

    expect(result).toEqual({ received: true, duplicate: false });
    expect(prisma.stripeEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: 'evt_2', type: 'checkout.session.completed' }) });
    expect(prisma.workspace.update).toHaveBeenCalledWith({
      where: { id: workspaceId },
      data: { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', billingStatus: BillingStatus.ACTIVE },
    });
  });

  it('maps invoice events to the subscription id, not the invoice id', async () => {
    prisma.stripeEvent.findUnique.mockResolvedValue(null);
    prisma.workspace.findUnique.mockResolvedValue({ id: workspaceId });

    await service.ingestEvent(event({
      id: 'evt_3',
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_1', subscription: 'sub_1', customer: 'cus_1' } },
    }));

    expect(prisma.workspace.update).toHaveBeenCalledWith({
      where: { id: workspaceId },
      data: expect.objectContaining({
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        billingStatus: BillingStatus.PAST_DUE,
      }),
    });
  });
});
