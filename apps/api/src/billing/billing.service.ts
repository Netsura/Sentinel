import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { BillingStatus, Prisma, WorkspaceRole } from '@prisma/client';
import { AuthUser } from '../auth/auth.service';
import { withAudit } from '../common/audit';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { StripeGateway, StripeSubscriptionSnapshot, StripeWebhookEvent } from './stripe.gateway';

const STATUS_MAP: Record<string, BillingStatus> = {
  trial: BillingStatus.TRIALING,
  trialing: BillingStatus.TRIALING,
  active: BillingStatus.ACTIVE,
  past_due: BillingStatus.PAST_DUE,
  canceled: BillingStatus.CANCELED,
  cancelled: BillingStatus.CANCELED,
  unpaid: BillingStatus.UNPAID,
  incomplete: BillingStatus.PAST_DUE,
  incomplete_expired: BillingStatus.CANCELED,
};

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly stripe: StripeGateway,
  ) {}

  async status(user: AuthUser, workspaceId: string) {
    await this.workspaces.requireMembership(user, workspaceId);
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { billingStatus: true, billingPlan: true, currentPeriodEnd: true, stripeCustomerId: true, stripeSubscriptionId: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    return { ...workspace, configured: this.stripe.enabled() };
  }

  async checkout(user: AuthUser, workspaceId: string) {
    this.requireStripe();
    await this.workspaces.requireMembership(user, workspaceId, WorkspaceRole.OWNER);
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw new NotFoundException('Workspace not found');

    const customerId = workspace.stripeCustomerId ?? (await this.stripe.createCustomer({ email: user.email, workspaceId }));
    if (!workspace.stripeCustomerId) {
      await this.prisma.workspace.update({ where: { id: workspaceId }, data: { stripeCustomerId: customerId } });
    }

    const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
    const url = await this.stripe.createCheckoutSession({
      customerId,
      workspaceId,
      successUrl: `${origin}/?billing=success`,
      cancelUrl: `${origin}/?billing=cancelled`,
    });
    return { url };
  }

  async portal(user: AuthUser, workspaceId: string) {
    this.requireStripe();
    await this.workspaces.requireMembership(user, workspaceId, WorkspaceRole.OWNER);
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace?.stripeCustomerId) throw new BadRequestException('This workspace has no billing customer yet');
    const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
    return { url: await this.stripe.createPortalSession({ customerId: workspace.stripeCustomerId, returnUrl: `${origin}/` }) };
  }

  async handleWebhook(payload: Buffer, signature?: string) {
    this.requireStripe();
    if (!signature) throw new BadRequestException('Stripe-Signature header is required');
    const event = this.stripe.constructEvent(payload, signature);
    return this.ingestEvent(event);
  }

  /**
   * Idempotent ingest: the Stripe event id is the primary key. A retry that
   * already landed is a no-op so webhook delivery and the reconcile job can
   * share the same apply path.
   */
  async ingestEvent(event: StripeWebhookEvent) {
    const existing = await this.prisma.stripeEvent.findUnique({ where: { id: event.id } });
    if (existing) return { received: true, duplicate: true };

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.stripeEvent.create({ data: { id: event.id, type: event.type, livemode: event.livemode, payload: event.data.object as Prisma.InputJsonValue } });
        await this.applyEvent(tx, event);
      });
      return { received: true, duplicate: false };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { received: true, duplicate: true };
      }
      throw error;
    }
  }

  async reconcile(user: AuthUser, workspaceId: string) {
    this.requireStripe();
    await this.workspaces.requireMembership(user, workspaceId, WorkspaceRole.OWNER);
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw new NotFoundException('Workspace not found');

    const remote = workspace.stripeSubscriptionId
      ? await this.stripe.retrieveSubscription(workspace.stripeSubscriptionId)
      : (await this.stripe.listSubscriptions()).find((item) => item.workspaceId === workspaceId);

    if (!remote) {
      if (workspace.billingStatus === BillingStatus.NONE) return { drifted: false, billingStatus: workspace.billingStatus };
      await withAudit(this.prisma, { workspaceId, userId: user.id, action: 'BILLING_RECONCILED', resource: 'Workspace', resourceId: workspaceId, metadata: { from: workspace.billingStatus, to: BillingStatus.NONE } }, async (tx) => {
        await tx.workspace.update({ where: { id: workspaceId }, data: { billingStatus: BillingStatus.NONE, stripeSubscriptionId: null, billingPlan: null, currentPeriodEnd: null } });
      });
      return { drifted: true, billingStatus: BillingStatus.NONE };
    }

    const next = this.snapshotToUpdate(remote);
    const drifted = workspace.billingStatus !== next.billingStatus
      || workspace.stripeSubscriptionId !== remote.id
      || workspace.billingPlan !== next.billingPlan;

    if (drifted) {
      await withAudit(this.prisma, { workspaceId, userId: user.id, action: 'BILLING_RECONCILED', resource: 'Workspace', resourceId: workspaceId, metadata: { from: workspace.billingStatus, to: next.billingStatus } }, async (tx) => {
        await tx.workspace.update({ where: { id: workspaceId }, data: { ...next, stripeCustomerId: remote.customerId, stripeSubscriptionId: remote.id } });
      });
    }

    return { drifted, billingStatus: next.billingStatus };
  }

  private async applyEvent(tx: Prisma.TransactionClient, event: StripeWebhookEvent) {
    const object = event.data.object;
    if (event.type === 'checkout.session.completed') {
      const workspaceId = stringField(object, 'client_reference_id') ?? metadataWorkspace(object);
      const customerId = stringField(object, 'customer');
      const subscriptionId = stringField(object, 'subscription');
      if (workspaceId && (customerId || subscriptionId)) {
        await tx.workspace.update({
          where: { id: workspaceId },
          data: {
            stripeCustomerId: customerId ?? undefined,
            stripeSubscriptionId: subscriptionId ?? undefined,
            billingStatus: subscriptionId ? BillingStatus.ACTIVE : undefined,
          },
        });
      }
      return;
    }

    if (event.type.startsWith('customer.subscription.') || event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
      const snapshot = this.objectToSnapshot(object, event.type);
      if (!snapshot) return;
      const workspace = await this.findWorkspace(tx, snapshot);
      if (!workspace) return;
      await tx.workspace.update({
        where: { id: workspace.id },
        data: { ...this.snapshotToUpdate(snapshot), stripeCustomerId: snapshot.customerId, stripeSubscriptionId: snapshot.id },
      });
    }
  }

  private async findWorkspace(tx: Prisma.TransactionClient, snapshot: StripeSubscriptionSnapshot) {
    if (snapshot.workspaceId) return tx.workspace.findUnique({ where: { id: snapshot.workspaceId } });
    if (snapshot.id) {
      const bySubscription = await tx.workspace.findUnique({ where: { stripeSubscriptionId: snapshot.id } });
      if (bySubscription) return bySubscription;
    }
    return tx.workspace.findUnique({ where: { stripeCustomerId: snapshot.customerId } });
  }

  private objectToSnapshot(object: Record<string, unknown>, type: string): StripeSubscriptionSnapshot | null {
    const id = type.startsWith('invoice.') ? stringField(object, 'subscription') : stringField(object, 'id');
    const customerId = stringField(object, 'customer');
    if (!id || !customerId) return null;
    const status = type === 'invoice.payment_failed' ? 'past_due' : type === 'invoice.paid' ? 'active' : stringField(object, 'status') ?? 'active';
    const period = typeof object.current_period_end === 'number' ? new Date(object.current_period_end * 1000) : undefined;
    const items = object.items as { data?: Array<{ price?: { id?: string } }> } | undefined;
    return { id, customerId, status, priceId: items?.data?.[0]?.price?.id, currentPeriodEnd: period, workspaceId: metadataWorkspace(object) };
  }

  private snapshotToUpdate(snapshot: StripeSubscriptionSnapshot) {
    return {
      billingStatus: STATUS_MAP[snapshot.status] ?? BillingStatus.ACTIVE,
      billingPlan: snapshot.priceId ?? null,
      currentPeriodEnd: snapshot.currentPeriodEnd ?? null,
    };
  }

  private requireStripe() {
    if (!this.stripe.enabled()) throw new ServiceUnavailableException('Stripe is not configured');
  }
}

function stringField(object: Record<string, unknown>, key: string) {
  const value = object[key];
  return typeof value === 'string' && value ? value : undefined;
}

function metadataWorkspace(object: Record<string, unknown>) {
  const metadata = object.metadata;
  if (!metadata || typeof metadata !== 'object') return undefined;
  return stringField(metadata as Record<string, unknown>, 'workspaceId');
}
