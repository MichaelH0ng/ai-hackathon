# NorthStar

**Keep your financial goals in sight.**

Design reference: [NorthStar Brand Guidelines](BRAND_GUIDELINES.md)

NorthStar brings everyday accounts, savings plans, and spending choices into one beginner-friendly dashboard:

1. **See your money.** Add accounts manually or connect through Plaid to review balances, holdings, net worth, cash flow, top spending, upcoming bills, and recent transactions.
2. **Plan ahead.** Set savings goals, estimate retirement savings, and see how a purchase could affect a goal's timeline.
3. **Track your NorthStar.** A solar-system visualization brings planets into orbit as you reach savings-goal milestones.
4. **Ask Polaris.** Ask questions about balances, goals, spending, or retirement using your dashboard data. Financial-chat context is sent to the configured AI service.
5. **Check a price or study.** Compare a purchase with your goals, or create a day-by-day exam plan.

## Run it

```bash
npm install
npm run dev              # app on http://localhost:5173 (+ API on :8787)
```

On the home page, tap **Try it with sample data** to load the $1,199 new phone and spring break examples.

Optional:
- **Photo reading**: `cp .env.example .env`, add an Anthropic API key, then restart. Typed prices work without a key.
- **Money dashboard (Plaid)**: add `PLAID_CLIENT_ID`, `PLAID_SANDBOX_SECRET` and `PLAID_ENV=sandbox` to `.env`. On the Money page, tap **Use a test student bank** (made-up data you can edit in `server/sandboxStudent.ts`), or **Connect a bank** and sign in with `user_good` / `pass_good` for Plaid's own test data. Bank connections are saved in `server/data/` (git-ignored).
- **On your phone** (same Wi-Fi): `npm run dev:phone` and open the "Network" URL.
- **Tests**: `npm test`


## 30-second demo

1. **Home**: tap **Try it with sample data**. In "How much can you save this week?", turn the dial from $15 to $30. The $1,199 new phone goal moves closer as you increase weekly savings. Tap **Save $30/week to my plan**.
2. **Check a price**: take a photo of a price tag, or type AirPods for $129.
   - It shows 7h 10m of work, the new phone arriving 60 days later and the trip 36 days later.
   - Tap **Skip it and keep $129**.
3. **New phone goal**: in "What if I buy something?", enter dinner out for $20 and cook at home for $5.
   - Dinner out adds 9.3 days and cooking adds 2.3 days.
   - Tap **Get cook at home instead**.

## Code map

| | |
|---|---|
| `src/lib/finance.ts` | Weeks to goal, what-if delay, deadline amount, recommendation text, hours of work |
| `src/lib/storage.ts` | Browser storage (localStorage) + sample data |
| `src/components/Landing.tsx` | Home page: hero, `SavingsPlanner` (weekly-savings `CometDial`), three feature cards |
| `src/components/PriceCheck.tsx` | Photo or typed price → hours of work, delay per goal, skip / cheaper / buy |
| `src/components/Money*.tsx` | Savings-goal forms and goal pages |
| `src/lib/money.ts` | Net worth, cash flow, top categories, upcoming bills, transfer detection (ported from money-dashboard) |
| `src/components/WealthDashboard.tsx` | Accounts, goal progress, budget, opportunity cost, and retirement planning |
| `src/components/NorthStar.tsx` | Solar-system progress visualization tied to savings-goal milestones |
| `src/components/MoneyAssistant.tsx` | On-device answers to common questions using dashboard data |
| `src/lib/moneyAssistant.ts` | Dashboard-aware assistant responses; no external model request |
| `src/components/MoneyDashboard.tsx` | Connected bank activity and spending details |
| `server/plaid.ts` | `/api/plaid/*`: link token, exchange, sandbox test bank, dashboard data, disconnect |
| `server/index.ts` | `/api/scan`: image → item, price and a cheaper option, via Claude |

**Formulas**
- Weeks to goal = (goal − saved) ÷ weekly savings.
- Delay = cost ÷ weekly savings × 7. This assumes the cost comes from savings.
- Suggested study hours grow with the gap between readiness (confidence or latest quiz) and the target grade. It's a rough estimate, not a grade prediction.

## Linked portfolios

In **Accounts**, choose **Connect portfolio** to link a brokerage or retirement account through Plaid Investments. Connected account balances appear once, with individual holdings expandable inside the matching account. Holdings are included in account balances and are not added to net worth a second time. **Refresh** retrieves the latest data available from Plaid; this is not a live market-price feed.

Set `PLAID_CLIENT_ID`, `PLAID_SANDBOX_SECRET`, and `PLAID_ENV=sandbox` in the ignored server `.env` file, then restart the API. A sandbox secret alone is not enough: the matching Client ID is required. **Test portfolio** creates a Plaid sandbox investment connection without real credentials. **Connect a portfolio** opens Plaid Link for supported investment accounts. Sandbox never connects real accounts.

Real portfolios require approved Plaid Production access with Investments, the Production secret in `PLAID_PRODUCTION_SECRET`, and `PLAID_ENV=production` (the older single `PLAID_SECRET` name still works). Production and sandbox connection files are kept separate. This local app uses a single local-user connection store; user authentication and per-user token storage are required before deploying it as a multi-user service.
