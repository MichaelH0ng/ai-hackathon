import { describe, expect, it } from "vitest";
import { bankDataForPlan, includedItems } from "./planningAccounts";

describe("planning account selection", () => {
  it("keeps an opted-out account visible in the source list but removes it from planning data", () => {
    const accounts = [{ id: "college", name: "College checking" }, { id: "personal", name: "Personal checking" }];
    expect(includedItems(accounts, ["college"])).toEqual([{ id: "personal", name: "Personal checking" }]);

    const data = bankDataForPlan({
      env: "manual", fetchedAt: "2026-11-15T00:00:00.000Z", status: [], holdings: [],
      accounts: [
        { id: "college", name: "College checking", institution: "Campus CU", mask: null, type: "depository", subtype: "checking", current: 400, available: 400 },
        { id: "personal", name: "Personal checking", institution: "North Bank", mask: null, type: "depository", subtype: "checking", current: 200, available: 200 },
      ],
      transactions: [
        { id: "tuition", accountId: "college", date: "2026-11-01", name: "University", amount: 200, category: "RENT_AND_UTILITIES", pending: false },
        { id: "groceries", accountId: "personal", date: "2026-11-02", name: "Market", amount: 30, category: "FOOD_AND_DRINK", pending: false },
      ],
    }, ["college"]);

    expect(data?.accounts.map((account) => account.id)).toEqual(["personal"]);
    expect(data?.transactions.map((transaction) => transaction.id)).toEqual(["groceries"]);
  });
});
