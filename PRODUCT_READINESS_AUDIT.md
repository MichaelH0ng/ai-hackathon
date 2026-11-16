# NorthStar product-readiness guide

## Product promise

NorthStar should help a college student answer one practical question well: **what can I safely spend today while still protecting my near-term obligations and goals?**

The app already has the right building blocks: Plaid-connected accounts, account inclusion controls, cash envelopes for goals, a 30-day purchase forecast, a budget and retirement plan, goal paths, and Polaris for questions and confirmed changes. The next step is making each number clear about what it knows and does not know.

## Real-user journeys

### 1. First week with NorthStar

1. Create a profile and add an hourly wage if the student has one.
2. Connect the checking account where pay is deposited, a savings account, and optionally a credit card or brokerage; manual accounts remain a valid private fallback.
3. On Money, decide which accounts affect planning. A tuition-only checking account can stay visible but be excluded from goals and affordability.
4. Create one or two goals with a target, an amount already set aside, a weekly contribution, and an optional deadline.
5. Use the Plan page to enter after-tax income and cash expenses that Plaid cannot see.

**Success condition:** the student can explain where every budget number comes from and can see their unassigned cash.

### 2. Everyday purchase decision

1. Open **Can I afford it?** from Home, Goals, or Polaris.
2. Enter a price, or photograph a price when image scanning is enabled.
3. NorthStar forecasts the next 30 days using posted activity, recurring income/bills, the current cash balance, manual cash accounts, and money already set aside for other goals.
4. It returns safe, tight, or not-yet—plus a date after a predicted deposit when relevant.

**Important interpretation:** “safe” means the forecast stays above zero with a comfort margin, not that the purchase is objectively wise. Pending transactions remain visible but are not used for historical spending totals because they can change before posting.

### 3. Paying for school and irregular expenses

A student may have a tuition-only account, a large semester textbook purchase, a trip home, or a reimbursement. The account-inclusion control and manual budget are essential here. The app should not treat a reimbursement as wages or a one-off tuition bill as a normal monthly subscription.

**Needed next capability:** let the student mark a transaction as “one-time,” “reimbursable,” “shared,” or “do not use in planning.” This is more valuable than another generic chart because it corrects the inputs that drive every forecast.

### 4. Bills and cash-flow anxiety

The Home and Money pages surface detected recurring charges and projected due dates. These are estimates inferred from prior posted transactions, not bills Plaid confirms. A user should be able to mark a detected bill as correct, ignore it, edit its cadence/amount, or create a bill that is paid in cash.

**Needed next capability:** a bill-review inbox, with a clear “projection from past activity” label, user confirmation, and an optional low-balance alert before a confirmed bill.

### 5. Working toward several goals

The Goal Path and weekly-savings tools answer whether the student’s deadlines fit their income, current spending, and other goal commitments. This is particularly useful for a car, study abroad, rent deposit, and emergency fund competing for the same dollars.

**Needed next capability:** priority order. Let the student label each goal Essential, Important, or Flexible. When capacity is insufficient, NorthStar can then show which flexible goal needs a later deadline instead of implicitly treating every goal as equally urgent.

### 6. Income that is variable or incomplete

Campus shifts, tips, gig work, internships, grants, and family transfers make automatic income detection unreliable. NorthStar currently avoids inventing a savings capacity when it has no income evidence, which is the correct default.

**Needed next capability:** an income schedule where the student can confirm paydays, expected hours, and one-time income. It should distinguish “confirmed,” “expected,” and “already received” amounts.

### 7. Credit cards and debt

Connected credit cards are included in net worth and activity. A student needs more than that: statement balance, payment due date, minimum due, available credit, APR, and whether a payment is planned from checking.

**Needed next capability:** a debt/payments panel. Do not automatically recommend investing before credit-card interest or a missing emergency buffer is understood.

### 8. Investing and retirement

The Plan page provides an educational projection, which is appropriate for a college audience. It must remain explicitly illustrative: balance data is not a trading signal, projected return is an assumption, and tax eligibility cannot be inferred from an account name.

**Needed next capability:** account education (Roth IRA vs. taxable brokerage), contribution tracking entered by the user, and a simple cash-buffer check before contribution suggestions. Avoid security-picking or return guarantees.

### 9. Asking Polaris a question

Polaris should route factual questions (spending, posted inflows, interest labels, goal progress) to deterministic calculations first. AI is best reserved for explanation, trade-offs, and a proposed action that the user explicitly confirms. The app already follows this pattern in many paths.

**Needed next capability:** attach a small source note to every answer: date range, accounts included, posted/pending treatment, and the last known bank-data update. This makes a financial answer easy to verify without exposing a full transaction dump.

## Information-quality rules

| Number shown | Treat it as | Never imply |
| --- | --- | --- |
| Account balance | Current value returned by the connected institution | A guaranteed real-time available-to-spend amount |
| Spending / income trend | Posted transactions in a stated date range | Final while a relevant charge is pending |
| Upcoming bill / payday | Projection from recurring past activity | A confirmed obligation or deposit |
| Goal finish date | Result of current saved amount, weekly amount, and deadline | A guarantee |
| Retirement chart | Illustration using a user-selected return | Investment advice or promised performance |
| AI answer | Explanation of supplied facts or a user-confirmed proposal | An action already made or personalized tax/legal advice |

## Audit of the current pages

### Home

What works: a personalized welcome, a clear money snapshot, goals, bills, and a single purchase-check action.

Improve next: show an explicit “posted activity” note near monthly spending; add a compact empty state for a student with manual-only accounts; show a low-cash warning only when the forecast has enough history.

### Money

What works: account grouping, balances, recent activity, cash flow, and account-level goal linking.

Improve next: add account detail/history, a transaction search/filter, and a way to correct categories. Present a review flow for recurring bills. Account disconnect must always remain available and explain any failure.

### Plan

What works: transparent budget arithmetic, a reserve/buffer, account exclusions, and retirement projection in one place.

Improve next: show the exact date window behind observed spending; handle seasonal/semester costs; add a “cash expenses not seen by Plaid” field; keep retirement inputs separate from monthly affordability.

### My Goals

What works: goal envelopes, deadline math, weekly-capacity guardrails, multi-goal scenarios, and the purchase check.

Improve next: priority ordering, goal categories, a one-time contribution log, and a clean explanation when goals claim more cash than exists. A linked account should only belong to one whole-balance goal.

### Profile and settings

What works: local profile details, wage, and app preferences.

Improve next: export/delete local planning data; show which information is saved locally versus connected through Plaid; add notification consent and a small privacy center.

## Changes completed in this pass

1. **Pending transactions no longer affect historical cash-flow, category, recurring-bill, or net-worth-trend calculations.** They remain visible in the transaction list. This prevents a pending card charge from temporarily changing the month’s spending result.
2. **Duplicate linked-account protection.** A single bank balance can no longer be reserved twice by affordability math when two goals point to the same account. The Money interface prevents choosing an account already followed by another goal and calls out older conflicting links.
3. **Unified Plaid connections now fetch both sides.** A connection containing a bank account and brokerage is stored as a unified connection, so NorthStar loads both transactions and investment holdings rather than silently dropping bank activity.
4. **More honest freshness labels.** Money distinguishes an actual last successful bank-activity update from the time NorthStar merely checked the server.
5. **Recoverable disconnects.** Disconnect buttons are disabled during the request and show a readable error when the request fails.
6. **API failure contract.** A dashboard-level Plaid failure now returns JSON with a retry-friendly message instead of an Express HTML error page.

## Shipping gates before real users

These are intentionally not implemented automatically because they require a product/security decision rather than a local UI tweak.

1. **Per-user authentication and durable encrypted token storage — blocking.** The current server file store is suitable for local development and a demo, not a multi-user deployment. In particular, a serverless temporary filesystem is not durable, and there is no user identity boundary around stored Plaid items. Use an authenticated backend, per-user encrypted token storage, key management, access logging, and deletion.
2. **Plaid production readiness — blocking.** Configure production webhooks, Link redirect/allowed origins, consent/relink handling, and institution error recovery. Sandbox data is not proof of production behavior.
3. **Privacy policy and data controls — blocking.** Explain Plaid access, AI processing, retention, deletion, and support contact. Add export/delete controls before collecting student financial data.
4. **Financial disclosures — blocking for recommendations.** Keep the tool educational; have counsel review consumer, privacy, and notification requirements before any broad launch.

## Prioritized roadmap

### Next build (highest value)

1. Bill review and transaction-category correction.
2. Goal priorities and a one-time contribution log.
3. Income schedule for variable campus work, grants, and cash income.
4. Assistant citations/source notes and a visible data-freshness indicator on answers.
5. Low-balance and upcoming-bill alerts after explicit notification consent.

### Later, after secure accounts exist

1. Cross-device sync and account onboarding progress.
2. Credit-card due-date/APR/payoff support.
3. Scholarship, reimbursement, and shared-expense workflows.
4. Financial-aid and tuition-calendar planning.
5. Accessibility audit with keyboard, screen-reader, contrast, reduced-motion, and mobile stress testing.

## Test scenarios to run with real consented data

- A first-time user with no transactions, no wage, and manual cash only.
- A paycheck that varies every two weeks.
- A pending restaurant charge that later posts at a different tip-adjusted amount.
- A transfer between checking and savings with the same amount as a grocery purchase nearby.
- A reimbursement, refund, cash withdrawal, and shared Venmo payment.
- Tuition paid once a quarter and a monthly rent bill.
- Two goals that intentionally split one savings account.
- A student whose goal allocation is higher than cash on hand.
- An expired Plaid connection, a partial item failure, and a relink flow.
- A bank and brokerage linked together in one Plaid Link session.

## Product metrics worth measuring only after consent and security work

- First-value completion: user connected/entered cash, created a goal, and ran a purchase check.
- Forecast trust: how often a user marks a bill or category correction.
- Goal feasibility: percentage of active goals with a deadline and sustainable weekly plan.
- Assistant quality: factual answer success, fallback rate, latency, and cost per resolved question.
- Retention: students who return before a predicted bill or goal milestone.
