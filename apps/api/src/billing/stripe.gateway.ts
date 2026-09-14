import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';

export type StripeSubscriptionSnapshot = {
  id: string;
  customerId: string;
  status: string;
  priceId?: string;
  currentPeriodEnd?: Date;
  workspaceId?: string;
};

export type StripeWebhookEvent = {
  id: string;
  type: string;
  livemode: boolean;
  data: { object: Record<string, unknown> };
};

export abstract class StripeGateway {
  abstract enabled(): boolean;
  abstract constructEvent(payload: Buffer, signature: string): StripeWebhookEvent;
  abstract retrieveSubscription(id: string): Promise<StripeSubscriptionSnapshot | null>;
  abstract listSubscriptions(): Promise<StripeSubscriptionSnapshot[]>;
  abstract createCustomer(params: { email: string; workspaceId: string }): Promise<string>;
  abstract createCheckoutSession(params: { customerId: string; workspaceId: string; successUrl: string; cancelUrl: string }): Promise<string>;
  abstract createPortalSession(params: { customerId: string; returnUrl: string }): Promise<string>;
}

@Injectable()
export class LiveStripeGateway extends StripeGateway {
  private readonly client: Stripe | null;
  private readonly webhookSecret: string | undefined;
  private readonly priceId: string | undefined;

  constructor() {
    super();
    this.client = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
    this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    this.priceId = process.env.STRIPE_PRICE_ID;
  }

  enabled() {
    return Boolean(this.client);
  }

  constructEvent(payload: Buffer, signature: string): StripeWebhookEvent {
    if (!this.client || !this.webhookSecret) throw new Error('Stripe webhook is not configured');
    const event = this.client.webhooks.constructEvent(payload, signature, this.webhookSecret);
    return { id: event.id, type: event.type, livemode: event.livemode, data: { object: event.data.object as unknown as Record<string, unknown> } };
  }

  async retrieveSubscription(id: string) {
    if (!this.client) return null;
    const subscription = await this.client.subscriptions.retrieve(id);
    return this.toSnapshot(subscription);
  }

  async listSubscriptions() {
    if (!this.client) return [];
    const items: StripeSubscriptionSnapshot[] = [];
    for await (const subscription of this.client.subscriptions.list({ status: 'all', limit: 100 })) {
      items.push(this.toSnapshot(subscription));
    }
    return items;
  }

  async createCustomer(params: { email: string; workspaceId: string }) {
    if (!this.client) throw new Error('Stripe is not configured');
    const customer = await this.client.customers.create({ email: params.email, metadata: { workspaceId: params.workspaceId } });
    return customer.id;
  }

  async createCheckoutSession(params: { customerId: string; workspaceId: string; successUrl: string; cancelUrl: string }) {
    if (!this.client || !this.priceId) throw new Error('Stripe checkout is not configured');
    const session = await this.client.checkout.sessions.create({
      mode: 'subscription',
      customer: params.customerId,
      line_items: [{ price: this.priceId, quantity: 1 }],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      client_reference_id: params.workspaceId,
      subscription_data: { metadata: { workspaceId: params.workspaceId } },
    });
    if (!session.url) throw new Error('Stripe did not return a checkout URL');
    return session.url;
  }

  async createPortalSession(params: { customerId: string; returnUrl: string }) {
    if (!this.client) throw new Error('Stripe is not configured');
    const session = await this.client.billingPortal.sessions.create({ customer: params.customerId, return_url: params.returnUrl });
    return session.url;
  }

  private toSnapshot(subscription: Stripe.Subscription): StripeSubscriptionSnapshot {
    const item = subscription.items.data[0];
    return {
      id: subscription.id,
      customerId: String(subscription.customer),
      status: subscription.status,
      priceId: item?.price.id,
      currentPeriodEnd: periodEnd(subscription),
      workspaceId: subscription.metadata?.workspaceId || undefined,
    };
  }
}

function periodEnd(subscription: Stripe.Subscription) {
  const value =
    (subscription as Stripe.Subscription & { current_period_end?: number }).current_period_end ??
    subscription.items.data[0]?.current_period_end;
  return typeof value === 'number' ? new Date(value * 1000) : undefined;
}
