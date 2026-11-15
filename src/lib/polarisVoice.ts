import { useEffect, useState } from "react";

/** The voice Polaris reads answers with, chosen from the voices this browser already has. */

const VOICE_KEY = "northstar:polaris-voice";

export const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

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
  const saved = readVoicePreference();
  return ranked.find(v => v.voiceURI === saved) ?? ranked[0] ?? null;
}

/** Speak text in Polaris's voice. Returns the utterance so callers can listen for its end. */
export function speakAsPolaris(text: string, voice = pickVoice()): SpeechSynthesisUtterance {
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, ""));
  if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
  else utterance.lang = navigator.language || "en-US";
  utterance.rate = 1;
  utterance.pitch = 1.05; // a touch brighter, to match the mascot
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
