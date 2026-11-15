import { useEffect, useState } from "react";

/** The voice Polaris reads answers with, chosen from the voices this browser already has. */

const VOICE_KEY = "northstar:polaris-voice";

export const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

/** Friendly display names; keep the installed voice URI for playback and preferences.
 * SpeechSynthesis exposes no gender metadata, so only alias known voice names. */
export function voiceLabels(voices: Pick<SpeechSynthesisVoice, "name" | "voiceURI">[]): Map<string, string> {
  const labels = new Map<string, string>();
  const groups = [
    { names: ["Riya", "Kayla", "Astra"], match: /\b(ava|samantha|allison|susan|zoe|serena|jenny|aria|emma|michelle|libby|sonia|natasha|karen|moira|tessa|joelle|salli|zira|victoria|siri female|female)\b/i },
    { names: ["Michael", "Nick"], match: /\b(daniel|evan|nathan|alex|david|mark|tom|oliver|guy|ryan|james|aaron|arthur|lee|rishi|siri male|male)\b/i },
  ];
  for (const group of groups) {
    const seen = new Set<string>();
    const distinct = voices.filter(voice => {
      const identity = voice.name.match(group.match)?.[0].toLowerCase();
      if (!identity || seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
    distinct.slice(0, group.names.length)
      .forEach((voice, index) => labels.set(voice.voiceURI, group.names[index]));
  }
  return labels;
}

export type VoicePersona = "Astra" | "Riya" | "Kayla" | "Michael" | "Nick";
export const voiceStyles: Record<VoicePersona, { rate: number; pitch: number }> = {
  Astra: { rate: 0.94, pitch: 1.08 },
  Riya: { rate: 1.08, pitch: 1.28 },
  Kayla: { rate: 0.98, pitch: 0.92 },
  Michael: { rate: 0.88, pitch: 0.62 },
  Nick: { rate: 0.98, pitch: 0.8 },
};

export function personaVoices(voices: SpeechSynthesisVoice[]) {
  const labels = voiceLabels(voices);
  const named = (name: VoicePersona) => voices.find(voice => labels.get(voice.voiceURI) === name) ?? null;
  const female = named("Riya");
  const male = named("Michael");
  return {
    Astra: named("Astra") ?? named("Kayla") ?? female,
    Riya: female,
    Kayla: named("Kayla") ?? female,
    Michael: male,
    Nick: named("Nick") ?? male,
  };
}

function selectedPersona(voices: SpeechSynthesisVoice[]): VoicePersona {
  const saved = readVoicePreference();
  if (saved && saved in voiceStyles && Object.hasOwn(voiceStyles, saved)) return saved as VoicePersona;
  // Migrate older preferences that stored the installed voice URI.
  return voiceLabels(voices).get(saved ?? "") as VoicePersona || "Astra";
}

// macOS novelty voices: fun, but not for reading money answers.
const novelty = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|ralph|kathy|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley)\b/i;
// Voices that tend to sound warm and natural.
const friendly = /\b(ava|samantha|allison|susan|zoe|serena|jenny|aria|emma|michelle|libby|sonia|natasha|karen|moira|tessa|daniel|evan|nathan|joelle|nicky)\b/i;

/** Higher is friendlier. Exported for tests. */
export function voiceScore(voice: Pick<SpeechSynthesisVoice, "name" | "lang">, language: string): number {
  const name = voice.name;
  if (novelty.test(name)) return -100;
  let score = 0;
  const lang = voice.lang.toLowerCase().replace("_", "-");
  const want = language.toLowerCase();
  if (lang === want) score += 10;
  else if (lang.split("-")[0] === want.split("-")[0]) score += 5;
  else return -100; // a different language would mispronounce English answers
  if (/natural|neural/i.test(name)) score += 50; // Edge's online neural voices
  if (/premium|enhanced|siri/i.test(name)) score += 35; // downloaded high-quality Apple voices
  if (/^google\b/i.test(name)) score += 25;
  if (friendly.test(name)) score += 15;
  if (/compact|espeak/i.test(name)) score -= 20;
  return score;
}

/** Voices in the user's language, friendliest first. */
export function rankVoices(voices: SpeechSynthesisVoice[], language = navigator.language || "en-US"): SpeechSynthesisVoice[] {
  return voices
    .map(voice => ({ voice, score: voiceScore(voice, language) }))
    .filter(v => v.score > -50)
    .sort((a, b) => b.score - a.score || a.voice.name.localeCompare(b.voice.name))
    .map(v => v.voice);
}

export function readVoicePreference(): string | null {
  try { return localStorage.getItem(VOICE_KEY); } catch { return null; }
}
export function saveVoicePreference(voiceURI: string | null) {
  try {
    if (voiceURI) localStorage.setItem(VOICE_KEY, voiceURI);
    else localStorage.removeItem(VOICE_KEY);
  } catch { /* storage unavailable: the choice lasts for this visit only */ }
}

/** The saved voice if it's still installed, otherwise the friendliest one available. */
export function pickVoice(): SpeechSynthesisVoice | null {
  if (!canSpeak) return null;
  const ranked = rankVoices(window.speechSynthesis.getVoices());
  return personaVoices(ranked)[selectedPersona(ranked)];
}

/** Preview and normal playback share the same persona, voice, pitch, and pace. */
export function speakAsPolaris(text: string, persona?: VoicePersona): SpeechSynthesisUtterance {
  window.speechSynthesis.cancel();
  const voices = rankVoices(window.speechSynthesis.getVoices());
  const selected = persona ?? selectedPersona(voices);
  const voice = personaVoices(voices)[selected];
  if (!voice) throw new Error(`No ${selected === "Michael" || selected === "Nick" ? "male" : "female"} voice is installed for ${selected}.`);
  const utterance = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, ""));
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = voiceStyles[selected].rate;
  utterance.pitch = voiceStyles[selected].pitch;
  window.speechSynthesis.speak(utterance);
  return utterance;
}

/** Ranked voices; browsers load the list asynchronously, so this updates when it arrives. */
export function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => (canSpeak ? rankVoices(window.speechSynthesis.getVoices()) : []));
  useEffect(() => {
    if (!canSpeak) return;
    const update = () => setVoices(rankVoices(window.speechSynthesis.getVoices()));
    update();
    window.speechSynthesis.addEventListener("voiceschanged", update);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);
  return voices;
}
