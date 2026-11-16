import { describe, expect, it } from "vitest";
import { accountIdRemapper } from "./accountMatch";
import type { BankAccount } from "./money";

const acct = (id: string, name: string, mask: string | null, subtype = "checking"): BankAccount => ({ id, name, mask, type: "depository", subtype, current: 100, available: 100, institution: "Chase" });

describe("accountIdRemapper", () => {
  it("follows an account to its new ID after its bank is reconnected", () => {
    const known: Record<string, string> = {};
    accountIdRemapper([acct("old-chk", "Total Checking", "1234"), acct("old-sav", "Savings", "9876", "savings")], known);
    const remap = accountIdRemapper([acct("new-chk", "Total Checking", "1234"), acct("new-sav", "Savings", "9876", "savings")], known);
    expect(remap("old-chk")).toBe("new-chk");
    expect(remap("old-sav")).toBe("new-sav");
    expect(remap("new-chk")).toBe("new-chk");
  });
  it("leaves IDs alone when the account isn't connected or can't be told apart", () => {
    const known: Record<string, string> = {};
    accountIdRemapper([acct("old", "Checking", null)], known);
    expect(accountIdRemapper([], known)("old")).toBe("old");
    expect(accountIdRemapper([acct("a", "Checking", null), acct("b", "Checking", null)], known)("old")).toBe("old");
    expect(accountIdRemapper([acct("x", "Checking", "1111")], known)("never-seen")).toBe("never-seen");
  });
});
