import { describe, expect, it } from "vitest";
import { bestAlternative, correctNames, fixVoiceText, spokenAmounts } from "./voiceFix";

const names = ["Car fund", "Acorns", "Trader Joe's", "Spring break trip", "Taqueria Santa Cruz"];

describe("correctNames", () => {
  it("fixes near-misses of your names and finance terms", () => {
    expect(fixVoiceText("how much is in my wrath IRA", names)).toBe("how much is in my Roth IRA");
    expect(correctNames("did a corns charge me", names)).toBe("did Acorns charge me");
    expect(correctNames("add 20 to my care fund", names)).toBe("add 20 to my Car fund");
    expect(correctNames("how much at trader joes last month?", names)).toBe("how much at Trader Joe's last month?");
  });
  it("leaves ordinary words and correct text alone", () => {
    expect(correctNames("I don't care about shoes", names)).toBe("I don't care about shoes");
    expect(correctNames("I shall save more", ["Shell"])).toBe("I shall save more");
    expect(correctNames("move money to my Car fund", names)).toBe("move money to my Car fund");
    expect(correctNames("what did I spend on food", names)).toBe("what did I spend on food");
  });
});

describe("spokenAmounts", () => {
  it("turns spoken amounts into numbers", () => {
    expect(spokenAmounts("can I afford eighty dollars shoes")).toBe("can I afford $80 shoes");
    expect(spokenAmounts("put a hundred and twenty bucks in savings")).toBe("put $120 in savings");
    expect(spokenAmounts("a goal for fifteen hundred")).toBe("a goal for 1500");
    expect(spokenAmounts("twenty-five dollars a week")).toBe("$25 a week");
    expect(spokenAmounts("can I afford $80 dollars shoes")).toBe("can I afford $80 shoes");
    expect(spokenAmounts("it was 5 dollars and 50 cents")).toBe("it was $5.50");
    expect(spokenAmounts("two thousand five hundred dollars")).toBe("$2500");
  });
  it("leaves small numbers in normal speech alone", () => {
    expect(spokenAmounts("which one costs more")).toBe("which one costs more");
    expect(spokenAmounts("a coffee and a bagel")).toBe("a coffee and a bagel");
  });
});

describe("bestAlternative", () => {
  it("prefers the guess that mentions your own names", () => {
    expect(bestAlternative(["add twenty to my care fund", "add twenty to my car fund"], names)).toBe("add twenty to my car fund");
    expect(bestAlternative(["hello there", "hollow there"], names)).toBe("hello there");
  });
});
