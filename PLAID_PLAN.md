# Plaid plan

## Goal

NorthStar: beginner-friendly personal finance dashboard (balances, spending, savings goals, AI chat) already using Plaid, looking to increase usage of Plaid features. First round: debt and bills. (workflow_id: wf_ab90e5dccfcddcab)

## Scope

- Products: **Transactions** in `products` (spending, balances, 730 days of history). **Investments** and **Liabilities** in `additional_consented_products` (SELECT-005, LIAB-007, INV-015): consent now, billed on first read, no cut to bank coverage.
- Add-on: **Recurring Transactions** (`/transactions/recurring/get`) for detected bills (TXN-016). Entitled in Sandbox and US Production (checked in the Dashboard, GUIDE-016). History is requested at 730 days, above the 180-day minimum (TXN-017).
- Rejected: Balance product / `/accounts/balance/get` (only for an explicit refresh-now feature, BAL-001/002); Identity Verification and Income (no onboarding or lending flow in this app yet); Layer (no PII onboarding).
- Platform: web/TypeScript (React + Express). Every Plaid call is server-side (GUIDE-003).
- Environment: sandbox until acceptance passes.

## Human tasks

| Task | Why it matters | Where | State |
|------|----------------|-------|-------|
| Register a public HTTPS webhook receiver | Detected bills and debts refresh only when the page loads; webhooks would let Plaid push updates and power low-balance and bill-due alerts (WEBHOOK-005) | https://dashboard.plaid.com | needs_human |
| Register an OAuth redirect URI | Without it, OAuth banks (Chase and others) can silently drop users in Link (GUIDE-011) | https://dashboard.plaid.com | needs_human |
| Tap "Add card and loan details" for banks connected before this change | Existing connections never consented to Liabilities. The button opens Link in update mode, so history is kept and no second connection is billed | App → Money → Activity → Debt and payments | needs_human |

## Implementation checklist

- [x] Link token requests Liabilities as an additional consented product on bank and unified connections; brokerage-only connections unchanged (`server/plaid.ts`)
- [x] `/liabilities/get` read per connection that has a card or loan; purchase APR chosen by `apr_type`; every field nullable (`src/lib/debt.ts`, LIAB-002/003/008)
- [x] `/transactions/recurring/get` read once the bank's activity is ready; PRODUCT_NOT_READY handled; streams ended by Plaid dropped
- [x] Ten-minute per-connection cache so page loads and Polaris questions do not call these endpoints repeatedly (PITFALL-005)
- [x] Old connections without consent flagged (`needsDebtConsent`) instead of failing
- [x] Bills on Home, Money, and in Polaris use Plaid's streams, falling back to the app's own estimate; the UI says which one it is
- [x] Debt and payments panel on Money (`src/components/DebtPanel.tsx`); Polaris receives debts
- [x] Sandbox student connection requests Liabilities where there is a card (`server/sandboxStudent.ts`, LIAB-006)
- [x] Sync keeps a saved cursor and the full transaction list per connection (`server/syncStore.ts`); added, modified and removed are all applied; nothing is saved until the last page arrives; a change mid-paging restarts the batch
- [x] Update mode for expired logins and for adding card/loan consent: `POST /api/plaid/link-token` with `itemId`, `ReconnectButton`, OAuth-return handling
- [ ] Webhooks (`SYNC_UPDATES_AVAILABLE`, `RECURRING_TRANSACTIONS_UPDATE`, `LIABILITIES: DEFAULT_UPDATE`, item errors) once a public receiver exists

## Acceptance

- Round 4 (2026-11-19): FAIL, same 4 open items (006, 007, 012, 014). Free-only improvements (the developer asked for nothing Plaid bills extra): /item/get freshness now read from the response's top-level status (it was read from item.status and never showed); consent_expiration_time drives a "Renew" update-mode prompt 30 days ahead (OAUTH-009); holdings carry cost_basis for gains; transactions carry logo_url, website and counterparties (sync version 3 re-syncs once); low-confidence categories over $40 become quick questions (TXN-006); bank logos no longer sent to the model. dashboard_get_state confirms redirect_uris and webhooks are empty.
- Round 3 (2026-11-19): FAIL (4 of 15 not met, down from 5). Guidance re-read and plaid.ts reviewed against it: rate limits now detected by error_type RATE_LIMIT_EXCEEDED (ITEM-002/004) and keep the last balances, transactions, debts and bills instead of blanking them; overlapping loads share one Plaid trip and /item/get is cached a minute (ITEM-010/013). Sandbox end to end re-run in an isolated data dir (NORTHSTAR_DATA_DIR) with two personas: 4 Items, 19 accounts, 111 transactions, 8 concurrent loads identical; update-mode link token created. Still failing: webhook receiver (006), OAuth redirect URI (007), browser-driven Link/OAuth journeys (012), webhooks vs load-time reads awaiting the developer's decision (014).
- Round 2: FAIL (5 of 15 not met, down from 9). Now passing: update mode for expired logins (004), saved sync cursor (005), added/modified/removed applied (010), goal fit on two personas (015). Still failing: webhook receiver (006), OAuth redirect URI not registered in the Dashboard (007), full guidance self-review (011), Link/OAuth journeys not driven end to end (012), webhooks instead of load-time reads (014). Removal of transactions is covered by unit tests only; Plaid sent none in the sandbox run.
- Round 1: FAIL (9 of 15 not met). Passed: link token, token storage, no secrets exposed, sandbox end-to-end, human-task list, live API answered. Failed: update-mode re-login (CHECK-004), persisted sync cursor (005), webhook receiver (006), OAuth redirect URI (007), modified/removed transactions (010), full guidance self-review (011), UI journeys not driven in a browser (012), webhooks instead of load-time reads (014), second test persona (015). 004, 005, 006, 007, 010 and 014 predate this round; 011, 012 and 015 are untested for this round.

## Maintenance

This integration is maintained with the Plaid MCP; this file is its durable state. Agents working in this repository: consult build_guidance before modifying any Plaid-touching code, and re-run build_check_acceptance before reporting such a change as working. The acceptance above applies only to the code as it was verified; later changes invalidate it.

## How to test

### Debt and payments

1. Start the app: `npm run dev`
2. Open Money and tap **Use a test student bank**.
3. Expected: a "Debt and payments" card lists the Student Visa with its balance, 24.99% APR, and a $35 minimum. The sandbox returns no due date, so none is shown.

### Detected bills

1. After the test bank loads (a few seconds), look at **Upcoming bills** on Money and Home.
2. Expected: rent, Verizon, Planet Fitness, and Spotify, with the note "Detected by Plaid from your bank history." If Plaid isn't ready yet, you see "Estimated from your past transactions" instead.

### Reconnect note

1. With a bank connected before this change, open Money.
2. Expected: "Card and loan details aren't available for <bank> yet. Disconnect it below and connect it again."

## Decisions made

- Detected bills replace the app's estimate whenever Plaid returns any (confirmed by user choice of "Debt + bills").
- Card/loan consent for existing connections uses Link update mode rather than disconnect and reconnect.
- Debts and streams are cached ten minutes per connection; no polling loop.
- Until a webhook receiver exists, these reads happen when the user loads the dashboard (WEBHOOK-005 stopgap).

## Open questions

- Should a bill-review inbox (confirm, ignore, or edit a detected bill) come next?
- Who registers the webhook receiver and tunnel for local development?
