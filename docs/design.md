# Design Document: Usage Metering & Billing Engine

## Problem

Every SaaS needs to track customer usage, enforce plan limits, and calculate charges. This service handles those three concerns for a platform that offers API calls and AI token processing, with correctness that survives retries, duplicate webhooks, and boundary conditions.

## Data Model

Four core tables:

- **plans**: Free (1,000 API calls / 100k AI tokens/mo) and Pro (50,000 / 5M)
- **tenants**: One row per customer org, linked to Stripe via `stripe_customer_id`
- **subscriptions**: Which tenant has which plan, current status, Stripe subscription ID
- **usage_events**: Every billable action with an **idempotency key** (UNIQUE constraint) that structurally prevents double-counting

Supporting tables:
- **usage_summaries**: Pre-aggregated monthly data (written by background job)
- **stripe_events**: Webhook deduplication by Stripe event ID

## API Surface

| Endpoint | Method | Purpose |
|---|---|---|
| `/generate` | POST | Record a billable event (quota-checked, idempotent) |
| `/usage?tenantId=X` | GET | Current-month rollup: plan, usage, cost, recent events |
| `/checkout` | POST | Create Stripe Checkout session for Pro upgrade |
| `/webhooks/stripe` | POST | Receive Stripe webhooks (signature-verified, deduplicated) |

## Layered Architecture

```
Routes → Services → Repositories → PostgreSQL
```

- **Routes**: Input validation, response formatting — no business logic
- **Services**: Quota enforcement, cost calculation, Stripe orchestration
- **Repositories**: Parameterized SQL queries, tenant isolation

## Key Correctness Guarantees

1. **Idempotency**: DB UNIQUE constraint on `idempotency_key` — concurrent duplicates resolve to one event
2. **Quota boundary**: `current + requested <= limit` (inclusive at boundary, 429 over)
3. **Integer math**: All money in micro-dollars or cents — zero floats
4. **Webhook security**: Signature verification before any processing; event ID deduplication
5. **Tenant isolation**: Every query includes `WHERE tenant_id = $1`

## Non-Goal

No invoicing, proration, or overage billing in v1.
