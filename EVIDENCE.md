# Evidence Log

Evidence for each acceptance probe — pasted proofs from actual test runs.

> Fill each section with the actual curl output, test log, or screenshot as you verify.

---

## Probe 1: Idempotency

**Requirement:** Same billable request sent twice with one idempotency key → exactly one usage event; second response mirrors the first.

```
# TODO: Paste curl output here after running
```

---

## Probe 2: Quota Enforcement

**Requirement:** Tenant driven to exact quota → boundary behaves per documented rule; next request returns 429/402 with clear message.

```
# TODO: Paste curl output here after running
```

---

## Probe 3: Stripe Checkout → Plan Upgrade

**Requirement:** Completed Stripe test checkout → webhook flips tenant Free → Pro; GET /usage reflects new limits.

```
# TODO: Paste curl/stripe CLI output here after running
```

---

## Probe 4: Webhook Security

**Requirement:** Forged webhook signature → 400, nothing changes; real event replayed twice → processed once.

```
# TODO: Paste curl output here after running
```

---

## Probe 5: Cost Calculation

**Requirement:** Pinned pricing rules → cached-input and reasoning-token math produces exact expected totals; /usage matches.

```
# TODO: Paste curl output and expected vs actual comparison here
```

---

## Unit Test Results

```
# TODO: Paste `npm test` output here
```
