-- Dashboard, reports and cash-flow queries always filter by business first; these composite indexes let them
-- read only that business's rows in order (won deals by close date, payments by date, latest activities).
CREATE INDEX "Deal_tenantId_stage_closedAt_idx" ON "Deal"("tenantId", "stage", "closedAt");
CREATE INDEX "Payment_tenantId_paidAt_idx" ON "Payment"("tenantId", "paidAt");
CREATE INDEX "Activity_tenantId_occurredAt_idx" ON "Activity"("tenantId", "occurredAt");
