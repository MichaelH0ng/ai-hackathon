import { describe, expect, it } from "vitest";
import { categoryKey, refineStoreCategories, refineUncertainCategories } from "./categorize";
import type { BankTransaction } from "./money";

let n = 0;
const tx = (p: Partial<BankTransaction>): BankTransaction => ({ id: `t${n++}`, accountId: "card", date: "2026-10-24", name: "7-Eleven", amount: 20, category: "GENERAL_MERCHANDISE", pending: false, ...p });
const NOW = new Date(2026, 10, 17);
const run = (list: BankTransaction[], answers: Record<string, string> = {}) => refineStoreCategories(list, answers, NOW);

describe("gas or snacks at stores that sell both", () => {
  it("uses your answer first", () => {
    const snack = tx({ amount: 16.95 });
    const fill = tx({ date: "2026-10-25", amount: 52.92 });
    const { transactions, questions } = run([snack, fill], { [categoryKey(snack)]: "FOOD_AND_DRINK", [categoryKey(fill)]: "TRANSPORTATION" });
    expect(transactions.map((t) => t.category)).toEqual(["FOOD_AND_DRINK", "TRANSPORTATION"]);
    expect(transactions[0].categorized).toEqual({ by: "you", confirmed: true });
    expect(questions).toHaveLength(0);
  });
  it("trusts the bank's own text and a confident Plaid detail", () => {
    const { transactions } = run([
      tx({ amount: 22, raw: "7-ELEVEN 41234 FUEL SAN LUIS OBISPO CA" }),
      tx({ amount: 30, detail: "FOOD_AND_DRINK_FAST_FOOD", confidence: "VERY_HIGH" }),
      tx({ amount: 30, detail: "TRANSPORTATION_GAS", confidence: "HIGH" }),
    ]);
    expect(transactions.map((t) => t.category)).toEqual(["TRANSPORTATION", "FOOD_AND_DRINK", "TRANSPORTATION"]);
  });
  it("learns from your answers at the same store, so it doesn't ask again", () => {
    const snack = tx({ amount: 16.95 });
    const fill = tx({ date: "2026-10-25", amount: 52.92 });
    const answers = { [categoryKey(snack)]: "FOOD_AND_DRINK", [categoryKey(fill)]: "TRANSPORTATION" };
    const later = [tx({ date: "2026-11-10", amount: 61.2 }), tx({ date: "2026-11-11", amount: 12.4 })];
    const { transactions, questions } = run([snack, fill, ...later], answers);
    expect(transactions.slice(2).map((t) => [t.category, t.categorized?.by])).toEqual([["TRANSPORTATION", "your answers"], ["FOOD_AND_DRINK", "your answers"]]);
    expect(questions).toHaveLength(0);
  });
  it("goes by amount when nothing else settles it, and asks only in the in-between range", () => {
    const { transactions, questions } = run([tx({ amount: 58 }), tx({ amount: 4.5 }), tx({ amount: 24 })]);
    expect(transactions.map((t) => t.category)).toEqual(["TRANSPORTATION", "FOOD_AND_DRINK", "FOOD_AND_DRINK"]);
    expect(questions.map((q) => q.amount)).toEqual([24]);
  });
  it("leaves Costco to Plaid, which already splits its gas station, and ignores other stores", () => {
    const { transactions, questions } = run([tx({ name: "Costco", amount: 28.47 }), tx({ name: "Trader Joe's", amount: 60 })]);
    expect(transactions.map((t) => t.category)).toEqual(["GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE"]);
    expect(questions).toHaveLength(0);
  });
  it("doesn't touch refunds, transfers, or payments with people", () => {
    const list = [tx({ amount: -20 }), tx({ category: "TRANSFER_OUT", amount: 50 }), tx({ amount: 30, review: { key: "k", label: "spending", confirmed: true } })];
    expect(run(list).transactions).toEqual(list);
  });
});

describe("when Plaid's gas label is wrong", () => {
  it("catches a restaurant named after a gas brand, and a few dollars at the mini-mart", () => {
    const { transactions } = run([
      tx({ name: "Shell", amount: 44.05, category: "TRANSPORTATION", detail: "TRANSPORTATION_GAS", confidence: "VERY_HIGH", raw: "SHELL BEACH BREWHOUSE PISMO BEACH CA" }),
      tx({ name: "ExxonMobil", amount: 2.68, category: "TRANSPORTATION", detail: "TRANSPORTATION_GAS", confidence: "VERY_HIGH", raw: "EXXON TIOGA PASS GAS M LEE VINING CA" }),
      tx({ name: "ExxonMobil", amount: 63.43, category: "TRANSPORTATION", detail: "TRANSPORTATION_GAS", confidence: "VERY_HIGH", raw: "EXXON BETTERAVIA GAS & SANTA MARIA CA" }),
    ]);
    expect(transactions.map((t) => t.category)).toEqual(["FOOD_AND_DRINK", "FOOD_AND_DRINK", "TRANSPORTATION"]);
  });
  it("asks about a mid-size charge Plaid itself isn't sure of", () => {
    const { questions } = run([tx({ name: "Speedway", amount: 41.9, category: "TRANSPORTATION", detail: "TRANSPORTATION_GAS", confidence: "LOW" })]);
    expect(questions.map((q) => q.amount)).toEqual([41.9]);
  });
});
it("counts a store with 'Fuel' in its name as gas", () => {
  expect(run([tx({ name: "Conserv Fuel", amount: 13.07, category: "FOOD_AND_DRINK" })]).transactions[0].category).toBe("TRANSPORTATION");
});

describe("charges Plaid wasn't sure how to file", () => {
  const unsure = (p: Partial<BankTransaction>) => tx({ name: "Alpha Kappa Psi", amount: 200, category: "GOVERNMENT_AND_NON_PROFIT", confidence: "LOW", ...p });
  it("asks about big recent ones, biggest first, and skips the obvious and the small", () => {
    const { questions } = refineUncertainCategories([
      unsure({}),
      unsure({ name: "Beyondsocal", amount: 209.21, category: "ENTERTAINMENT" }),
      unsure({ name: "Nón Lá Cafe", amount: 62.4, category: "FOOD_AND_DRINK" }), // a cafe filed as food: nothing to ask
      unsure({ name: 'Joaquin Boyd "Utilities"', amount: 178.45, category: "RENT_AND_UTILITIES" }), // your own note set it
      unsure({ name: "Myplots", amount: 37 }), // too small to move a total
      unsure({ name: "Sure thing", confidence: "HIGH" }),
      unsure({ name: "Old", date: "2026-01-02" }),
      unsure({ name: "Pending", pending: true }),
    ], {}, NOW);
    expect(questions.map((q) => [q.merchant, q.guess, q.kind])).toEqual([["Beyondsocal", "ENTERTAINMENT", "uncertain"], ["Alpha Kappa Psi", "GOVERNMENT_AND_NON_PROFIT", "uncertain"]]);
  });
  it("uses your answer, and stops asking", () => {
    const dues = unsure({});
    const { transactions, questions } = refineUncertainCategories([dues], { [categoryKey(dues)]: "GENERAL_SERVICES" }, NOW);
    expect(transactions[0]).toMatchObject({ category: "GENERAL_SERVICES", categorized: { by: "you", confirmed: true } });
    expect(questions).toHaveLength(0);
  });
  it("leaves payments with people and store charges to their own questions", () => {
    const venmo = unsure({ review: { key: "k", label: "spending", confirmed: false } });
    const store = unsure({ categorized: { by: "amount", confirmed: false } });
    expect(refineUncertainCategories([venmo, store], {}, NOW).questions).toHaveLength(0);
  });
});
