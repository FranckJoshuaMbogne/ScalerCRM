# Load test

`scripts/load-test.sh` builds a scratch database from the migrations, seeds it, and times the queries behind the busiest screens and jobs. Every query runs as a real signed-in user, so row level security applies. Each figure is the median of 5 runs (launching the campaign runs once).

```bash
DATABASE_URL=postgresql://postgres@localhost:5432/postgres scripts/load-test.sh   # add --keep to inspect the data afterwards
```

**Data:** one business with:
- 10 salespeople;
- 100,000 customers;
- 150,000 leads over two years, across all stages and sources;
- 60,000 orders, each with a payment, 70% delivered;
- about 51,000 tasks;
- 60,000 WhatsApp opt-ins and a campaign to all of them.

**Machine:** Postgres 16 on a 4-vCPU container, defaults untuned. Supabase's smallest paid compute is comparable.

## Results (Sprint 9 release candidate)

| Query | Median (ms) | Budget (ms) |
|-------|------------:|------------:|
| Lead list, page 1 (recent activity) | 0.5 | 300 |
| Lead list, page 200 | 5.7 | 300 |
| Lead list, hottest first | 0.6 | 300 |
| Lead list total count (admin, 150k leads) | 101 | 500 |
| Customer search by phone | 8.1 | 50 |
| Customer search by name prefix | 131 | 300 |
| Customer list, newest | 1.3 | 300 |
| Customer purchase history | 3.2 | 100 |
| Order list with balances | 1.5 | 300 |
| Analytics summary, 30 days | 272 | 1,000 |
| Analytics summary, 12 months | 478 | 2,000 |
| Breakdown by source, 12 months | 405 | 2,000 |
| Breakdown by owner, 12 months | 207 | 2,000 |
| Salesperson performance, 90 days | 39 | 2,000 |
| Operations summary | 47 | 1,000 |
| Campaign audience estimate (100k customers) | 1,424 | 2,000 |
| Launch a campaign to 60,000 recipients | 6,317 | 30,000 |
| Salesperson: my leads, page 1 | 1.1 | 300 |
| Salesperson: my lead count (15,000 leads) | 75 | 500 |
| Salesperson: today's tasks | 0.6 | 100 |
| Claim 1,000 campaign recipients (job runner) | 621 | 2,000 |
| Record 200 campaign sends (job runner) | 653 | 5,000 |

All 22 are within budget.

### Public API and webhooks (Sprint 13)

The API calls run as the anonymous role with a partner's key, through the `api_*` functions. A webhook endpoint listens for new leads, so the write test pays for queuing events.

| Query | Median (ms) | Budget (ms) |
|-------|------------:|------------:|
| API: leads, first page of 100 | 10.3 | 300 |
| API: leads, page 750 by cursor | 9.9 | 300 |
| API: customers changed in the last day | 6.5 | 300 |
| API: orders, page of 100 with lines | 18.8 | 500 |
| API: 20 leads in, webhook endpoint listening | 81 | 2,000 |
| Webhooks: claim 50 deliveries (job runner) | 0.5 | 500 |

These need the `(business_id, updated_at, id)` indexes added in migration `20270517000000`. With them, a deep page costs the same as the first. The other 22 queries are unchanged: all 28 are within budget.

**Campaign throughput:**
- the send queue claims about 1,600 recipients a second;
- recording a send takes about 3 ms;
- the database is not the limit. WhatsApp's per-number tier is: 1,000 to unlimited unique users a day, at up to 80 messages a second.

## At 1 million leads across 10 branches (Sprint 15)

```bash
LOAD_LEADS=1000000 DATABASE_URL=postgresql://postgres@localhost:5432/postgres scripts/load-test.sh
```

**Data:** one business with:
- 10 branches;
- 666,666 customers;
- 1,000,000 leads over two years;
- 400,000 orders, each with a payment;
- 340,000 tasks;
- 10,000 lead transfers;
- 40 branch targets.

Days older than 90 are in the analytics rollup. Seeding takes about 30 minutes; the queries take a few more.

| Query | Median (ms) | Budget (ms) |
|-------|------------:|------------:|
| Lead list, page 1 | 0.6 | 300 |
| Lead list, page 200 | 5.1 | 300 |
| Lead list total count (admin) | 407 | 500 |
| Customer search by phone | 17 | 50 |
| Customer search by name prefix | 97 | 300 |
| Analytics summary, 30 days | 396 | 1,000 |
| Analytics summary, 12 months | 614 | 2,000 |
| Breakdown by source, 12 months | 807 | 2,000 |
| Breakdown by owner, 12 months | 724 | 2,000 |
| Salesperson performance, 90 days | 577 | 2,000 |
| Operations summary | 186 | 1,000 |
| Branch comparison, 12 months | 646 | 2,000 |
| Branch comparison, 30 days | 430 | 1,000 |
| Team report for a branch, 90 days | 229 | 1,000 |
| Lead transfers, 12 months | 821 | 1,000 |
| Leaderboard, this month | 24 | 1,000 |
| Targets: 40 branch targets with progress | 255 | 1,000 |
| Campaign audience estimate (667k customers) | 962 | 2,000 |
| Launch a campaign to 60,000 recipients | 3,801 | 30,000 |
| Salesperson: my lead count (100,000 leads) | 371 | 500 |
| API pages, webhook claims and campaign queue | all under 455 | 300–5,000 |

All 34 are within budget.

**What the first run at this size found, and the fixes (migration `20270614000000`):**
1. **Seven queries were over budget:**
   - targets: 6.9 s;
   - campaign audience estimate: 4.9 s;
   - leaderboard: 4.1 s;
   - branch comparison, 12 months: 3.8 s;
   - branch comparison, 30 days: 3.3 s;
   - breakdown by source: 2.1 s;
   - summary, 30 days: 1.4 s.
2. **Missing indexes.** Analytics counts archived leads too, so the lead list's index (which skips them) couldn't serve period queries. Added indexes:
   - leads by `(business_id, created_at)`;
   - leads by `(business_id, closed_at)`;
   - walk-ins and appointments by time.
3. **Once per row instead of once.**
   - Targets and the leaderboard ran one query per target or per person. They now make one grouped pass per measure.
   - Outstanding balances went through the per-order `order_balances` view once per branch. They are now one grouped query (`private.open_balances`), and the branch comparison materialises it.
   - The audience checked consent and suppression per customer. Each is now one hashed lookup per query.
4. **Re-scans.** The breakdown re-scanned the attributed orders for every group. They are now aggregated once.
5. **Generic plans.** After five calls in a session, Postgres switched the report functions to a generic plan that was nearly three times slower (2.1 s instead of 0.8 s for the breakdown). Report functions now set `plan_cache_mode = force_custom_plan`; they run rarely and with very different periods.

## What the test found, and the fixes (migration `20270308000000`)

1. **Row level security cost one permission lookup per row.**
   - **Problem:** the read policies on leads, customers, orders and the other busy tables called `has_permission()` / `branch_visible()` for every row. At 150,000 leads:

     | Query | Time before the fix |
     |-------|--------------------:|
     | Admin's lead count | 39 s |
     | First page of the lead list | 36 s |
     | Salesperson's lead count | 34 s |

     The lead list asks for an exact count on every page view.
   - **Fix:** the policies now compare each row with arrays of the caller's permitted businesses and branches. The arrays are computed once per query (`private.permitted_business_ids()`, `my_business_ids()`, `my_branch_ids()`). The same three queries now take 101 ms, 0.5 ms and 75 ms.
   - **Safety:** access rules are unchanged, and every isolation test (suites 10–95) passes unmodified.
2. **No index for the lead list's sort.**
   - **Problem:** the list sorts by recent activity, or by score then activity, but the indexes were on creation date and score alone.
   - **Fix:** `leads_activity_idx` and a wider `leads_score_idx`.
3. **Lead scoring looked up appointments without an index.**
   - **Problem:** every lead change rescores the lead, which looks for its appointments. The search was a sequential scan, cheap on an empty table but growing with every booking.
   - **Fix:** `appointments_lead_idx`.

## Write costs (for imports and bulk jobs)

| Write | Cost | Why |
|-------|------|-----|
| Create a lead | about 3 ms | Scoring (twice), timeline, touchpoint triggers |
| Create a task | about 10 ms | Updates the lead's next follow-up, which rescores the lead and writes its timeline |
| Import 10,000 leads | about 30–40 s | Rows in batches of 250, each in its own savepoint |

These are fine for people and for imports. If automations ever create tasks in bulk (thousands at once), the first thing to change is to rescore on the columns scoring actually reads, instead of on every lead update.
