-- Migration 004: Create usage_events table
-- Every billable action records one row here.
-- The idempotency_key UNIQUE constraint is the structural guarantee against double-counting:
-- two concurrent INSERTs with the same key → one succeeds, one gets a unique violation.
-- This is NOT enforced at the application layer — it's a database-level invariant.

CREATE TABLE IF NOT EXISTS usage_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    usage_type      TEXT NOT NULL CHECK (usage_type IN ('api_call', 'ai_tokens')),
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    idempotency_key TEXT NOT NULL UNIQUE,   -- THE key constraint: no double-counting, ever
    metadata        JSONB DEFAULT '{}',     -- token breakdown for ai_tokens events
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary query pattern: "sum this tenant's usage for the current month"
CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_created
    ON usage_events (tenant_id, created_at);

-- Secondary: filter by type within a tenant's events
CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_type
    ON usage_events (tenant_id, usage_type, created_at);
