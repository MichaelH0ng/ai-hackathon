// A realistic college-student test user for Plaid Sandbox ("user_custom").
// Plaid builds the fake bank from this JSON, so you control balances and transactions.
// Docs: https://plaid.com/docs/sandbox/user-custom
// Plaid convention: amount > 0 is money out (a purchase), amount < 0 is money in.

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
};
const tx = (ago: number, description: string, amount: number) => ({
  date_transacted: daysAgo(ago),
  date_posted: daysAgo(Math.max(0, ago - 1)),
  amount,
  description,
  currency: "USD",
});

export function studentBanks() {
  const checking = [];
  const card = [];

  for (let ago = 3; ago <= 87; ago += 14) checking.push(tx(ago, "CAMPUS BOOKSTORE PAYROLL DIRECT DEP", -412.5)); // part-time job, every 2 weeks
  for (const ago of [2, 32, 62]) checking.push(tx(ago, "Mustang Village Apartments", 350)); // share of rent
  for (const ago of [5, 35, 65]) checking.push(tx(ago, "Verizon Wireless", 45)); // phone bill
  for (const ago of [9, 39, 69]) checking.push(tx(ago, "Spotify Student", 5.99));
  for (const ago of [12, 42, 72]) checking.push(tx(ago, "Planet Fitness", 10));
  for (const ago of [2, 16, 30, 44, 58, 72, 86]) checking.push(tx(ago, "Trader Joe's", 38 + (ago % 5) * 3)); // groceries, every 2 weeks
  for (const ago of [6, 26, 46, 66]) checking.push(tx(ago, "Transfer to Savings", 50));
  checking.push(tx(20, "Venmo from Mom", -100), tx(50, "Venmo from Mom", -100));

  const fun: [number, string, number][] = [
    [1, "Starbucks", 6.45],
    [4, "Chipotle", 12.85],
    [7, "Uber", 14.2],
    [8, "Starbucks", 4.75],
    [11, "Amazon", 27.99],
    [13, "Chipotle", 9.4],
    [15, "AMC Theatres", 16.5],
    [18, "Starbucks", 7.85],
    [22, "Uber Eats", 24.3],
    [25, "Target", 31.75],
    [29, "Chipotle", 14.6],
    [33, "Starbucks", 5.25],
    [37, "Shell Gas", 34.1],
    [41, "Uber", 23.9],
    [48, "Amazon", 18.49],
    [53, "Uber Eats", 15.6],
    [57, "Starbucks", 8.1],
    [62, "Chipotle", 11.2],
    [68, "Target", 22.3],
    [75, "Shell Gas", 31.8],
    [81, "Starbucks", 4.5],
  ];
  for (const [ago, name, amount] of fun) card.push(tx(ago, name, amount));
  for (const ago of [10, 40, 70]) card.push(tx(ago, "Payment Thank You", -150)); // paying the card off

  const savings = [6, 26, 46, 66].map((ago) => tx(ago, "Transfer from Checking", -50));

  // Three institutions, so the home page can show how money is split across banks and brokerages.
  return [
    {
      institution: "Campus Bank",
      config: {
        override_accounts: [
          { type: "depository", subtype: "checking", starting_balance: 742.18, meta: { name: "Student Checking", mask: "4821" }, transactions: checking },
          {
            type: "credit",
            subtype: "credit card",
            starting_balance: 184.62,
            meta: { name: "Student Visa", mask: "1177", limit: 1000 },
            transactions: card,
            // What Plaid Liabilities returns for this card. The sandbox doesn't return a due date for custom users,
            // so the panel shows the minimum without one, as it will at banks that don't share it.
            liability: {
              type: "credit",
              purchase_apr: 24.99,
              cash_apr: 29.99,
              balance_transfer_apr: 24.99,
              special_apr: 0,
              last_payment_amount: 150,
              last_statement_balance: 160.4,
              minimum_payment_amount: 35,
            },
          },
        ],
      },
    },
    {
      institution: "Sunrise Online Savings",
      config: {
        override_accounts: [{ type: "depository", subtype: "savings", starting_balance: 860, meta: { name: "High-Yield Savings", mask: "9034" }, transactions: savings }],
      },
    },
    {
      institution: "Summit Investing",
      config: {
        override_accounts: [
          { type: "investment", subtype: "roth", starting_balance: 2450, meta: { name: "Roth IRA", mask: "2201" } },
          { type: "investment", subtype: "brokerage", starting_balance: 640, meta: { name: "Brokerage", mask: "2202" } },
        ],
      },
    },
  ];
}
