-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('NONE', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'UNPAID');

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "stripeCustomerId" TEXT,
ADD COLUMN "stripeSubscriptionId" TEXT,
ADD COLUMN "billingStatus" "BillingStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN "billingPlan" TEXT,
ADD COLUMN "currentPeriodEnd" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Scan" ADD COLUMN "scheduleId" TEXT;

-- CreateTable
CREATE TABLE "StripeEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_stripeCustomerId_key" ON "Workspace"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_stripeSubscriptionId_key" ON "Workspace"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "Scan_scheduleId_createdAt_idx" ON "Scan"("scheduleId", "createdAt");

-- CreateIndex
CREATE INDEX "StripeEvent_type_processedAt_idx" ON "StripeEvent"("type", "processedAt");

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "ScheduledScan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
