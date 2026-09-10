-- Migration 006: Create stripe_events table (webhook deduplication)
-- Stores the Stripe event ID of every webhook we have already processed.
-- Before processing a webhook, we check this table — if the event_id exists, we skip.
-- This prevents replayed or redelivered webhooks from double-updating the database.

CREATE TABLE IF NOT EXISTS stripe_events (
    event_id     TEXT PRIMARY KEY,          -- Stripe's event ID, e.g. 'evt_1234...'
    event_type   TEXT NOT NULL,             -- e.g. 'checkout.session.completed'
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
