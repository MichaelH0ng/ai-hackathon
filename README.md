# NorthStar

**Know where your money is going, and where you want it to take you.**

An opportunity cost app for students that does three things:

1. **Check a price.** Snap a price tag (or type the price) and see the hours of work, the days it adds to each savings goal, and a cheaper idea.
2. **Save for something.** Set a goal and a weekly amount, then watch your finish date and progress move with your choices.
3. **See your money.** Connect a bank through Plaid to see net worth, cash flow, top spending, upcoming bills and recent transactions, each measured in days of your goals.

## Run it

```bash
npm install
npm run dev              # app on http://localhost:5173 (+ API on :8787)
```

On the home page, tap **Try it with sample data** to load the hoodie and spring break examples.

## Team setup

The repository includes safe, shareable demo data in `server/sandboxStudent.ts` and a credential-free template in `.env.example`. Teammates can get started with:

```bash
cp .env.example .env
npm install
npm run dev
```

Commit the fake student-bank data, `.env.example`, and `PLAID_ENV=sandbox`; do **not** commit `.env`, `PLAID_SECRET`, any AI API key, or files in `server/data/` (which can contain Plaid access tokens). The built-in **Use a test student bank** option uses made-up student data that is safe to demo, but it still sends that fixture to Plaid's Sandbox API. Each teammate who wants to use either bank option must add authorized Sandbox credentials to their local `.env`; Plaid's public test login is `user_good` / `pass_good`.

Optional:
- **Photo reading**: `cp .env.example .env`, add an Anthropic API key, then restart. Typed prices work without a key.
- **Money dashboard (Plaid)**: add `PLAID_CLIENT_ID`, `PLAID_SECRET` and `PLAID_ENV=sandbox` to `.env`. On the Money page, tap **Use a test student bank** (made-up data you can edit in `server/sandboxStudent.ts`), or **Connect a bank** and sign in with `user_good` / `pass_good` for Plaid's own test data. Bank connections are saved in `server/data/` (git-ignored).
- **On your phone** (same Wi-Fi): `npm run dev:phone` and open the "Network" URL.
- **Tests**: `npm test`

## 30-second demo

1. **Home**: tap **Try it with sample data**. In "How much can you save this week?", turn the dial from $15 to $30. The hoodie moves 21 days sooner and is on time for Christmas. Tap **Save $30/week to my plan**.
2. **Check a price**: take a photo of a price tag, or type AirPods for $129.
   - It shows 7h 10m of work, the hoodie arriving 60 days later and the trip 36 days later.
   - Tap **Skip it and keep $129**.
3. **Hoodie goal**: in "What if I buy something?", enter dinner out for $20 and cook at home for $5.
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
| `src/components/MoneyDashboard.tsx` | Money page: Plaid connect, widgets, goals linked to accounts |
| `server/plaid.ts` | `/api/plaid/*`: link token, exchange, sandbox test bank, dashboard data, disconnect |
| `server/index.ts` | `/api/scan`: image → item, price and a cheaper option, via Claude |

**Formulas**
- Weeks to goal = (goal − saved) ÷ weekly savings.
- Delay = cost ÷ weekly savings × 7. This assumes the cost comes from savings.
