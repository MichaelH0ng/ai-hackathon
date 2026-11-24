import { describe, expect, it } from "vitest";
import { greeting, nextPaycheck, payerName } from "./homeInsights";
import type { BankAccount, BankTransaction, RecurringStream } from "./money";

const account = (id: string, institution: string, type = "depository"): BankAccount => ({ id, name: id, mask: null, type, subtype: null, current: 100, available: 100, institution });
let n = 0;
const tx = (accountId: string, date: string, amount: number, category = "FOOD_AND_DRINK", name = "Shop"): BankTransaction =>
  ({ id: `t${n++}`, accountId, date, name, amount, category, pending: false } as BankTransaction);

describe("greeting", () => {
  it("follows the time of day", () => {
    expect(greeting(new Date(2026, 10, 24, 8))).toBe("Good morning");
    expect(greeting(new Date(2026, 10, 24, 13))).toBe("Good afternoon");
    expect(greeting(new Date(2026, 10, 24, 20))).toBe("Good evening");
    expect(greeting(new Date(2026, 10, 24, 2))).toBe("Good evening");
  });
});

describe("nextPaycheck", () => {
  const accounts = [account("chk", "Wells Fargo"), account("wf", "Wealthfront")];
  const stream = (over: Partial<RecurringStream>): RecurringStream => ({ id: "s", accountId: "chk", name: "PAYROLL ST OF CA CA PAYROLL XXXXX7052", amount: 600, direction: "in", frequency: "BIWEEKLY", nextDate: "2026-11-26", category: "INCOME", isActive: true, ...over });

  it("uses Plaid's next date and what the last paycheck actually was", () => {
    const transactions = [tx("chk", "2026-11-12", -649.02, "INCOME", "PAYROLL ST OF CA CA PAYROLL XXXXX7052"), tx("chk", "2026-10-29", -580, "INCOME", "PAYROLL ST OF CA CA PAYROLL XXXXX7052")];
    expect(nextPaycheck({ accounts, transactions, recurring: [stream({})] }, "2026-11-24")).toEqual({ date: "2026-11-26", payer: "State of California", amount: 649.02, frequency: "every two weeks" });
  });

  it("ignores interest, your own accounts, and stopped or past streams", () => {
    const recurring = [
      stream({ name: "Wealthfront transfer", nextDate: "2026-11-25" }),
      stream({ name: "Interest payment", nextDate: "2026-11-25" }),
      stream({ isActive: false, nextDate: "2026-11-25" }),
      stream({ nextDate: "2026-11-20" }),
    ];
    expect(nextPaycheck({ accounts, transactions: [], recurring }, "2026-11-24")).toBeNull();
  });

  it("falls back to Plaid's typical amount with no paycheck on record", () => {
    expect(nextPaycheck({ accounts, transactions: [], recurring: [stream({ name: "ACME CORP DIR DEP" })] }, "2026-11-24")).toMatchObject({ payer: "Acme Corp", amount: 600 });
  });

  it("names the payer from the bank's text", () => {
    expect(payerName("CAMPUS BOOKSTORE PAYROLL PPD 1234")).toBe("Campus Bookstore");
  });
});

