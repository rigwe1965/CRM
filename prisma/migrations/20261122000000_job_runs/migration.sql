-- Heartbeat for platform jobs: one row per run of the daily cron, so a stopped or failing job can be noticed.
-- Belongs to no business, so it has no tenantId and no row-level security; only the platform client uses it and
-- the application role gets no access at all (like the sign-in plumbing tables).

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN,
    "summary" JSONB,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobRun_job_startedAt_idx" ON "JobRun"("job", "startedAt");

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm_app') THEN
    EXECUTE 'REVOKE ALL ON "JobRun" FROM crm_app';
  END IF;
END
$$;
