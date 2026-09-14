import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { LiveStripeGateway, StripeGateway } from './stripe.gateway';

@Module({
  imports: [WorkspacesModule],
  controllers: [BillingController],
  providers: [BillingService, { provide: StripeGateway, useClass: LiveStripeGateway }],
  exports: [BillingService],
})
export class BillingModule {}
