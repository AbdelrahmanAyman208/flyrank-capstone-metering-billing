-- Migration 005: Create usage_summaries table (for background rollup job)
-- Stores pre-aggregated monthly usage per tenant for fast historical queries.
-- Written by the background cron job, not by the request path.

CREATE TABLE IF NOT EXISTS usage_summaries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    month           DATE NOT NULL,    -- first day of the month, e.g. '2026-09-01'
    api_calls_total INTEGER NOT NULL DEFAULT 0,
    ai_tokens_total INTEGER NOT NULL DEFAULT 0,
    cost_microdollars BIGINT NOT NULL DEFAULT 0,  -- total cost in micro-dollars (integer!)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (tenant_id, month)
);

CREATE INDEX IF NOT EXISTS idx_usage_summaries_tenant_month
    ON usage_summaries (tenant_id, month);
