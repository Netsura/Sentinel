import { Controller, Get, Headers, Post, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { BillingService } from './billing.service';

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('status')
  @UseGuards(JwtAuthGuard)
  status(@CurrentUser() user: AuthUser, @Headers('x-workspace-id') workspaceId: string) {
    return this.billing.status(user, workspaceId);
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  checkout(@CurrentUser() user: AuthUser, @Headers('x-workspace-id') workspaceId: string) {
    return this.billing.checkout(user, workspaceId);
  }

  @Post('portal')
  @UseGuards(JwtAuthGuard)
  portal(@CurrentUser() user: AuthUser, @Headers('x-workspace-id') workspaceId: string) {
    return this.billing.portal(user, workspaceId);
  }

  @Post('reconcile')
  @UseGuards(JwtAuthGuard)
  reconcile(@CurrentUser() user: AuthUser, @Headers('x-workspace-id') workspaceId: string) {
    return this.billing.reconcile(user, workspaceId);
  }

  @Post('webhook')
  webhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    if (!req.rawBody) throw new Error('Raw body is required for Stripe signature verification');
    return this.billing.handleWebhook(req.rawBody, signature);
  }
}
