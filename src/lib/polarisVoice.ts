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

// ---------- "Michael": your own cloned voice ----------
// Michael is read by the local voice service (voice/server.py) when it's running. Without it
// (another computer, or the service stopped), Michael falls back to a deep built-in voice.

let serviceCheck: { at: number; available: Promise<boolean> } | null = null;
/** Whether the local voice service is up (rechecked at most every 30 seconds). */
export function myVoiceAvailable(): Promise<boolean> {
  if (serviceCheck && Date.now() - serviceCheck.at < 30_000) return serviceCheck.available;
  const available = fetch("/api/voice/status")
    .then(r => r.json())
    .then((body: { available?: boolean }) => body.available === true)
    .catch(() => false);
  serviceCheck = { at: Date.now(), available };
  return available;
}

/** Answer text as speakable pieces: one or two sentences each, so playback starts quickly. Exported for tests. */
export function speechChunks(text: string): string[] {
  const plain = text.replace(/[*_#`>]/g, "").replace(/^\s*[-•]\s+/gm, "").replace(/\s*\n+\s*/g, ". ").replace(/\.\s*\./g, ".").replace(/([:!?])\./g, "$1").trim();
  const sentences = plain.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  const chunks: string[] = [];
  for (const sentence of sentences) {
    const last = chunks[chunks.length - 1];
    // Very short sentences ride along with the next one so the voice doesn't sound choppy.
    if (last && last.length < 25 && last.length + sentence.length < 280) chunks[chunks.length - 1] = `${last} ${sentence}`;
    else chunks.push(sentence.slice(0, 600));
  }
  return chunks;
}

// A silent clip played straight from the tap, so Safari lets the same player continue after loading.
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
let current: { stop: () => void } | null = null;

/** Stops whatever Polaris is saying, in any voice. */
export function stopPolarisSpeech() {
  current?.stop();
  current = null;
  if (canSpeak) window.speechSynthesis.cancel();
}

/**
 * Reads text aloud in the chosen voice. Call it straight from a tap. onEnd runs when it finishes
 * (not when stopped); onError gets a message if no voice can play.
 */
export function speak(text: string, options: { persona?: VoicePersona; onEnd?: () => void; onError?: (message: string) => void } = {}) {
  stopPolarisSpeech();
  const voices = canSpeak ? rankVoices(window.speechSynthesis.getVoices()) : [];
  const persona = options.persona ?? selectedPersona(voices);
  const browserVoice = (from: string) => {
    try {
      const utterance = speakAsPolaris(from, persona);
      utterance.onend = () => options.onEnd?.();
      utterance.onerror = () => options.onEnd?.();
    } catch (error) {
      options.onError?.(error instanceof Error ? error.message : "This voice is unavailable. Choose another in Settings.");
    }
  };
  if (persona !== "Michael") { browserVoice(text); return; }

  const audio = new Audio();
  audio.src = SILENT_WAV;
  audio.play().catch(() => { /* only unlocking the player */ });
  let stopped = false;
  let wake: () => void = () => {};
  const urls: string[] = [];
  const handle = { stop: () => { stopped = true; audio.pause(); wake(); urls.forEach(url => URL.revokeObjectURL(url)); } };
  current = handle;
  const clip = (piece: string) => fetch("/api/voice/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: piece }) })
    .then(r => { if (!r.ok) throw new Error("voice unavailable"); return r.blob(); });

  void (async () => {
    const pieces = speechChunks(text);
    if (!pieces.length || !(await myVoiceAvailable())) {
      if (!stopped) { current = null; browserVoice(text); }
      return;
    }
    let next = clip(pieces[0]);
    for (let i = 0; i < pieces.length; i++) {
      let blob: Blob;
      try { blob = await next; } catch {
        // The service went away mid-answer: finish in the built-in voice.
        if (!stopped) { current = null; browserVoice(pieces.slice(i).join(" ")); }
        return;
      }
      if (stopped) return;
      if (i + 1 < pieces.length) next = clip(pieces[i + 1]); // make the next sentence while this one plays
      const url = URL.createObjectURL(blob);
      urls.push(url);
      audio.src = url;
      await new Promise<void>(resolve => {
        wake = resolve;
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.play().catch(() => resolve());
      });
      if (stopped) return;
    }
    if (current === handle) current = null;
    urls.forEach(url => URL.revokeObjectURL(url));
    options.onEnd?.();
  })();
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
