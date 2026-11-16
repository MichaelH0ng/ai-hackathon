import { useEffect, useState } from "react";
import { Square, Volume2 } from "lucide-react";
import { canSpeak, myVoiceAvailable, readVoicePreference, saveVoicePreference, speak, stopPolarisSpeech, useVoices, personaVoices, voiceLabels, type VoicePersona } from "../lib/polarisVoice";
import { Card } from "./ui";
import { PolarisAvatar } from "./PolarisAvatar";

const SAMPLE = "Hi, I’m Polaris! You’re 80 percent of the way to your emergency fund. Nice work.";

/** Settings card: choose the voice Polaris reads answers with, and hear a sample. */
export function PolarisVoiceSettings() {
  const voices = useVoices();
  const [choice, setChoice] = useState<string>(() => readVoicePreference() ?? "");
  const [playing, setPlaying] = useState(false);
  // Michael is your cloned voice when the local voice service is running.
  const [mine, setMine] = useState<boolean | null>(null);
  useEffect(() => { void myVoiceAvailable().then(setMine); }, []);
  useEffect(() => () => stopPolarisSpeech(), []);

  if (!canSpeak) {
    return <Card>
      <h3 className="font-bold text-stone-900">Polaris voice</h3>
      <p className="text-sm text-stone-600">This browser can’t read answers aloud. Try Chrome, Edge, or Safari.</p>
    </Card>;
  }

  const assigned = personaVoices(voices);
  const options = (["Astra", "Riya", "Kayla", "Michael", "Nick"] as const).map(name => ({ name, voice: name === "Michael" && mine ? true : assigned[name] }));
  const legacyName = voiceLabels(voices).get(choice);
  const saved = options.find(option => option.name === choice || option.name === legacyName)?.name ?? "Astra";

  function choose(persona: VoicePersona) {
    setChoice(persona);
    saveVoicePreference(persona);
    preview(persona);
  }
  function preview(persona: VoicePersona = saved) {
    setPlaying(true);
    speak(SAMPLE, { persona, onEnd: () => setPlaying(false), onError: () => setPlaying(false) });
  }

  function stop() {
    stopPolarisSpeech();
    setPlaying(false);
  }

  return <Card>
    <div className="flex items-center gap-3">
      <PolarisAvatar size={36} mood={playing ? "happy" : "idle"} />
      <div>
        <h3 className="font-bold text-stone-900">Polaris voice</h3>
        <p className="text-sm text-stone-600">The voice Polaris uses when you press Listen.</p>
      </div>
    </div>
    <label className="mt-4 block text-sm font-semibold text-stone-800" htmlFor="polaris-voice">Voice</label>
    <div className="mt-1 flex gap-2">
      <select
        id="polaris-voice"
        className="min-h-12 min-w-0 flex-1 rounded-xl bg-stone-50 px-3 text-sm text-stone-900 ring-1 ring-stone-300 focus:outline-none focus:ring-2 focus:ring-brand-500"
        value={saved}
        onChange={e => choose(e.target.value as VoicePersona)}
        disabled={!options.some(option => option.voice)}
      >
        {options.map(({ name, voice }) => <option key={name} value={name} disabled={!voice}>{name}{voice ? "" : " (unavailable)"}</option>)}
      </select>
      <button
        type="button"
        onClick={() => (playing ? stop() : preview())}
        disabled={!options.find(option => option.name === saved)?.voice}
        aria-label={playing ? "Stop the sample" : "Hear a sample"}
        className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-stone-100 px-4 text-sm font-bold text-stone-800 ring-1 ring-stone-300 hover:bg-stone-200 disabled:opacity-50"
      >
        {playing ? <Square className="h-4 w-4" fill="currentColor" aria-hidden="true" /> : <Volume2 className="h-4 w-4" aria-hidden="true" />}
        {playing ? "Stop" : "Hear it"}
      </button>
    </div>
    <p className="mt-2 text-xs text-stone-600">
      Astra is calm, Riya is bright, Kayla is relaxed, Michael is Michael’s own voice, and Nick is lively.{" "}
      {mine ? "Michael’s voice is running on this computer." : mine === false ? "Michael’s voice isn’t running on this computer, so Michael uses a deep built-in voice for now." : ""}{" "}
      Other voices come from this device and need a matching installed voice.
    </p>
  </Card>;
}
