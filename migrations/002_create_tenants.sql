-- Migration 002: Create tenants table
-- One row per customer organization.
-- stripe_customer_id is nullable — populated when the tenant first checks out.

CREATE TABLE IF NOT EXISTS tenants (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    email               TEXT,
    stripe_customer_id  TEXT UNIQUE,    -- nullable until first Stripe interaction
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_stripe_customer
    ON tenants (stripe_customer_id)
    WHERE stripe_customer_id IS NOT NULL;
