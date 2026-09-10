-- Migration 003: Create subscriptions table
-- Links a tenant to a plan. Tracks Stripe subscription state.
-- A tenant has exactly one active subscription at a time.

CREATE TABLE IF NOT EXISTS subscriptions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan_id                 UUID NOT NULL REFERENCES plans(id),
    status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'past_due', 'canceled', 'incomplete')),
    stripe_subscription_id  TEXT UNIQUE,   -- nullable for Free plan
    current_period_start    TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', NOW()),
    current_period_end      TIMESTAMPTZ NOT NULL DEFAULT (date_trunc('month', NOW()) + INTERVAL '1 month'),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup: "what subscription does this tenant have?"
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant
    ON subscriptions (tenant_id);

-- Ensure one active subscription per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_tenant_active
    ON subscriptions (tenant_id)
    WHERE status IN ('active', 'past_due');
