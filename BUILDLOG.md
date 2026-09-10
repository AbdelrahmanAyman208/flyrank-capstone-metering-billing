# Build Log

Where AI helped, where it was wrong, and what I changed. Every line I can defend if asked about.

---

## Session 1: Initial Build

### AI-Assisted Scaffolding
- **Used AI for:** Project structure, migration SQL, Express routing boilerplate, pricing config constants
- **AI contribution:** Generated the initial layered architecture (routes → services → repositories), migration files for all 6 tables, and the seed script
- **What I reviewed/changed:**
  - Verified the UNIQUE constraint on `usage_events.idempotency_key` is truly at the database level (not just application code)
  - Confirmed `ON CONFLICT (idempotency_key) DO NOTHING` + follow-up SELECT is the correct PostgreSQL pattern for structural idempotency
  - Checked that all money values use integers (micro-dollars) — no floats anywhere in the calculation path
  - Validated the quota boundary rule: `current + requested <= limit` (inclusive)

### Key Design Decisions (mine, not AI's)
- Chose micro-dollars (not cents) for token pricing to avoid sub-cent precision loss
- Decided on inclusive boundary rule (1000th call allowed at limit of 1000)
- Pro plan limits set at 50× Free (50,000 API calls / 5M AI tokens)

### Where AI Was Wrong / What I Fixed
- *(Document any corrections as they come up during testing)*

---

## Patterns I Can Explain

### Structural Idempotency (usageEventRepo.insertEvent)
```sql
INSERT INTO usage_events (...) VALUES (...)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING *
```
If RETURNING returns 0 rows → the key already exists → SELECT the original.
This works under concurrent requests because PG's UNIQUE constraint is enforced at the transaction level. Two concurrent INSERTs with the same key: one succeeds, one gets a unique violation internally (handled by ON CONFLICT), one gets nothing back and falls through to the SELECT.

### Webhook Raw Body
Express's `express.json()` parses the body into an object, but Stripe's `constructEvent()` needs the raw bytes to verify the HMAC signature. Solution: mount `express.raw()` on the webhook path BEFORE the JSON parser.

### Integer Money Math
All pricing in micro-dollars (1 μ$ = $0.000001). A token costing $0.000250 is stored as the integer 250. Multiplication stays in integer space. The only float conversion is in `microdollarsToDollars()` for display — and even that uses string formatting, not float arithmetic.
