import { describe, expect, it } from "vitest";
import { buildForecast, evaluatePurchase, type Forecast } from "./safeToSpend";
import { friendlyName, sentenceMatchesFacts, shortDate, templateSentence, verdictFacts } from "./safeToSpendExplain";

// A small hand-made forecast: rent on Dec 12 drives the low point, paycheck on Nov 25.
const forecast: Forecast = {
  ...buildForecast({ cash: 700, savings: 860, transactions: [], cashAccountIds: [], goals: [], today: "2026-11-14" }),
  cushion: 63,
  lowPoint: 300,
  lowPointDate: "2026-12-12",
  headroom: 237,
  driver: { date: "2026-12-12", name: "Mustang Village", amount: -350, kind: "bill" },
  nextIncome: { date: "2026-11-25", name: "CAMPUS BOOKSTORE PAYROLL", amount: 412.5, kind: "income" },
  events: [
    { date: "2026-11-25", name: "CAMPUS BOOKSTORE PAYROLL", amount: 412.5, kind: "income" },
    { date: "2026-12-12", name: "Mustang Village", amount: -350, kind: "bill" },
  ],
};

describe("helpers", () => {
  it("formats dates and softens all-caps bank names", () => {
    expect(shortDate("2026-12-12")).toBe("Dec 12");
    expect(friendlyName("CAMPUS BOOKSTORE PAYROLL")).toBe("Campus Bookstore Payroll");
    expect(friendlyName("Mustang Village")).toBe("Mustang Village");
  });
});

describe("templateSentence", () => {
  it("writes a sentence for each verdict that passes its own fact check", () => {
    for (const price of [50, 200, 900]) {
      const facts = verdictFacts("AirPods", forecast, evaluatePurchase(forecast, price), ["Spring break trip"]);
      const sentence = templateSentence(facts);
      expect(sentence.length).toBeGreaterThan(20);
      expect(sentenceMatchesFacts(sentence, facts)).toBe(true);
    }
  });

  it("names the driver for a tight purchase", () => {
    const facts = verdictFacts("Jacket", forecast, evaluatePurchase(forecast, 200), []);
    expect(facts.verdict).toBe("tight");
    expect(templateSentence(facts)).toBe("You can cover it, but your balance would dip to about $100 around Dec 12, after Mustang Village, close to your $63 cushion.");
  });
});

describe("sentenceMatchesFacts", () => {
  const facts = verdictFacts("Jacket", forecast, evaluatePurchase(forecast, 200), []);
  it("accepts amounts and dates from the facts, rounded", () => {
    expect(sentenceMatchesFacts("Rent of $350 on Dec 12 leaves you about $100.", facts)).toBe(true);
  });
  it("rejects a made-up amount or date", () => {
    expect(sentenceMatchesFacts("You'd have $412 left on Dec 12.", facts)).toBe(true); // paycheck amount is a fact
    expect(sentenceMatchesFacts("You'd have $275 left.", facts)).toBe(false);
    expect(sentenceMatchesFacts("Rent is due December 3.", facts)).toBe(false);
  });
});
