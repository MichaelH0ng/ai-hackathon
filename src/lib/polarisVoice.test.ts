import { describe, expect, it } from "vitest";
import { personaVoices, voiceStyles, voiceLabels, voiceScore } from "./polarisVoice";

const v = (name: string, lang = "en-US") => ({ name, lang });

it("assigns the requested names to known female and male voices without relabeling unknown voices", () => {
  const voices = ["Daniel", "Samantha", "Unknown", "Alex", "Ava"].map(name => ({ name, voiceURI: `voice:${name}` }));
  const labels = voiceLabels(voices);
  expect(labels.get("voice:Samantha")).toBe("Riya");
  expect(labels.get("voice:Ava")).toBe("Kayla");
  expect(labels.get("voice:Daniel")).toBe("Michael");
  expect(labels.get("voice:Alex")).toBe("Nick");
  expect(labels.has("voice:Unknown")).toBe(false);
});

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

const installed = (name: string) => ({ name, voiceURI: `voice:${name}`, lang: "en-US" }) as SpeechSynthesisVoice;

it("uses different speakers rather than enhanced variants of one speaker", () => {
  const voices = ["Ava (Premium)", "Ava (Enhanced)", "Samantha", "Karen", "Daniel", "Daniel (Enhanced)", "Alex"].map(installed);
  const selected = personaVoices(voices);
  expect(selected.Riya?.name).toBe("Ava (Premium)");
  expect(selected.Kayla?.name).toBe("Samantha");
  expect(selected.Astra?.name).toBe("Karen");
  expect(selected.Michael?.name).toBe("Daniel");
  expect(selected.Nick?.name).toBe("Alex");
  expect(new Set(Object.values(selected).map(voice => voice?.voiceURI)).size).toBe(5);
  expect(new Set(Object.values(voiceStyles).map(style => `${style.pitch}:${style.rate}`)).size).toBe(5);
});

it("never substitutes a female voice for a missing male voice", () => {
  const selected = personaVoices([installed("Samantha")]);
  expect(selected.Astra?.name).toBe("Samantha");
  expect(selected.Kayla?.name).toBe("Samantha");
  expect(selected.Michael).toBeNull();
  expect(selected.Nick).toBeNull();
});
