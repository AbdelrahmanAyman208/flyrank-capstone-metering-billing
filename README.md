# Usage Metering & Billing Engine

A backend service that tracks per-tenant usage, enforces plan quotas, calculates costs using pinned pricing rules, and syncs plan state with Stripe via verified webhooks.

Built as a FlyRank backend engineering capstone — prioritizes correctness over feature count.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Express HTTP Server                       │
│                                                              │
│  POST /generate    GET /usage    POST /checkout    Webhooks  │
├──────────────────────────────────────────────────────────────┤
│                     Middleware Layer                          │
│           (Input Validation · Error Handler)                 │
├──────────────────────────────────────────────────────────────┤
│                     Service Layer                            │
│                                                              │
│  ┌─────────────┐ ┌─────────────┐ ┌──────────────────────┐   │
│  │  Metering   │ │   Quota     │ │   Cost Calculation   │   │
│  │  Service    │ │   Service   │ │   Service            │   │
│  └─────────────┘ └─────────────┘ └──────────────────────┘   │
│  ┌─────────────┐ ┌─────────────────────────────────────┐    │
│  │   Stripe    │ │   Background Jobs (node-cron)       │    │
│  │   Service   │ │   Monthly usage rollup w/ retry     │    │
│  └─────────────┘ └─────────────────────────────────────┘    │
├──────────────────────────────────────────────────────────────┤
│                   Repository Layer                           │
│   (Parameterized SQL · Tenant Isolation · Idempotency)      │
├──────────────────────────────────────────────────────────────┤
│                   PostgreSQL (Docker)                        │
│                                                              │
│  plans · tenants · subscriptions · usage_events              │
│  usage_summaries · stripe_events · schema_migrations         │
└──────────────────────────────────────────────────────────────┘
```

## Plans

| Plan | API Calls/mo | AI Tokens/mo | Price |
|------|-------------|-------------|-------|
| Free | 1,000 | 100,000 | $0 |
| Pro | 50,000 | 5,000,000 | $49/mo |

## Token Pricing (per token, in micro-dollars)

| Token Type | Rate | Rationale |
|---|---|---|
| Input tokens | 250 ($0.000250) | Standard input processing |
| Cached input tokens | 125 ($0.000125) | 50% discount — model reuses prior context |
| Output tokens | 1,000 ($0.001000) | Generation is more compute-intensive |
| Reasoning tokens | 1,000 ($0.001000) | Same rate as output — thinking is generation work |
| API call (flat) | 500 ($0.000500) | Per-call infrastructure overhead |

## Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- Stripe CLI (for webhook testing)

### Setup

```bash
# 1. Clone and install
git clone <repo-url>
cd flyrank-capstone-metering-billing
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your Stripe test-mode keys

# 3. Start PostgreSQL
docker compose up -d

# 4. Run migrations and seed data
npm run setup

# 5. Start the server
npm run dev

# 6. (In another terminal) Start Stripe webhook forwarding
stripe listen --forward-to localhost:3000/webhooks/stripe
```

### Test Endpoints

```bash
# Record a billable event
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"<TENANT_ID>","idempotencyKey":"test-1","usageType":"api_call","quantity":1}'

# Check usage
curl http://localhost:3000/usage?tenantId=<TENANT_ID>

# Create checkout session
curl -X POST http://localhost:3000/checkout \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"<TENANT_ID>"}'
```

### Run Tests

```bash
# Unit tests
npm test

# Acceptance probes
bash scripts/test-probes.sh <FREE_TENANT_ID> <PRO_TENANT_ID>
```

## Quota Boundary Rule

`current_usage + requested_quantity <= limit` — **inclusive** at the boundary.

- The 1,000th API call (bringing total to exactly 1,000) is **allowed**.
- The 1,001st is **rejected** with `429 Too Many Requests`.
- A tenant with a canceled/past-due subscription gets `402 Payment Required`.

## Key Correctness Guarantees

1. **Idempotency**: Database UNIQUE constraint on `idempotency_key` — no double-counting even under concurrent requests
2. **Integer math**: All money stored in micro-dollars (integers) — zero floats in any calculation path
3. **Webhook security**: Stripe signature verification + event ID deduplication
4. **Tenant isolation**: Every query includes `WHERE tenant_id = $1`

## Limitations (Honest)

- **No proration** — plan changes are immediate, no partial-month billing (Automated PDF invoices *are* generated monthly)
- **No overage billing** — usage over quota is rejected, not billed at a higher rate
- **Single-process** — background jobs run in-process via node-cron, not a separate worker
- **No authentication** — tenant ID is passed directly, suitable for demo only
- **No rate limiting** — quota enforcement limits total usage but not request frequency
- **AI usage is simulated** — token counts are caller-provided, no actual model calls
