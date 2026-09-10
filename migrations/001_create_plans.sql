-- Migration 001: Create plans table
-- Stores plan definitions (Free and Pro) with monthly usage limits.
-- Limits are integers — no floats for any value that feeds into billing math.

CREATE TABLE IF NOT EXISTS plans (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,           -- 'free' or 'pro'
    display_name TEXT NOT NULL,                  -- 'Free' or 'Pro'
    api_call_limit   INTEGER NOT NULL,           -- max API calls per month
    ai_token_limit   INTEGER NOT NULL,           -- max AI tokens per month
    price_cents      INTEGER NOT NULL DEFAULT 0, -- monthly price in cents (integer!)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
