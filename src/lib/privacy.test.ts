import { afterEach, describe, expect, it } from "vitest";
import { formatExact, formatExactRaw, formatMoney } from "./finance";
import { maskMoneyText, setMoneyHidden } from "./privacy";

describe("Hide amounts", () => {
  afterEach(() => setMoneyHidden(false));

  it("shows real amounts when off", () => {
    expect(formatMoney(1234)).toBe("$1,234");
    expect(maskMoneyText("You spent $1,204.50 on food.")).toBe("You spent $1,204.50 on food.");
  });

  it("masks formatted amounts but keeps a minus sign", () => {
    setMoneyHidden(true);
    expect(formatMoney(1234)).toBe("$•••••");
    expect(formatExact(-56.78)).toBe("−$•••••");
  });

  it("keeps real amounts for text that's saved or sent to Polaris", () => {
    setMoneyHidden(true);
    expect(formatExactRaw(56.78)).toBe("$56.78");
  });

  it("masks dollar amounts inside sentences and leaves other numbers alone", () => {
    setMoneyHidden(true);
    expect(maskMoneyText("You spent $1,204.50 on food, 12% more than the last 30 days. Rent is -$900."))
      .toBe("You spent $••••• on food, 12% more than the last 30 days. Rent is −$•••••.");
    expect(maskMoneyText("About $2k left")).toBe("About $••••• left");
  });
});
