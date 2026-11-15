import { describe, expect, it } from "vitest";
import { voiceScore } from "./polarisVoice";

const v = (name: string, lang = "en-US") => ({ name, lang });

describe("voiceScore", () => {
  it("prefers natural and enhanced voices over plain ones", () => {
    expect(voiceScore(v("Microsoft Aria Online (Natural) - English (United States)"), "en-US")).toBeGreaterThan(voiceScore(v("Google US English"), "en-US"));
    expect(voiceScore(v("Ava (Premium)"), "en-US")).toBeGreaterThan(voiceScore(v("Samantha"), "en-US"));
    expect(voiceScore(v("Google US English"), "en-US")).toBeGreaterThan(voiceScore(v("Microsoft David - English (United States)"), "en-US"));
  });

  it("drops novelty voices and other languages", () => {
    expect(voiceScore(v("Bad News"), "en-US")).toBeLessThan(-50);
    expect(voiceScore(v("Zarvox"), "en-US")).toBeLessThan(-50);
    expect(voiceScore(v("Amélie", "fr-CA"), "en-US")).toBeLessThan(-30);
  });

  it("keeps the same language in another region", () => {
    expect(voiceScore(v("Daniel", "en-GB"), "en-US")).toBeGreaterThan(0);
  });
});
