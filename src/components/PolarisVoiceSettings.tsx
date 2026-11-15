import { useEffect, useState } from "react";
import { Square, Volume2 } from "lucide-react";
import { canSpeak, readVoicePreference, saveVoicePreference, speakAsPolaris, useVoices } from "../lib/polarisVoice";
import { Card } from "./ui";
import { PolarisAvatar } from "./PolarisAvatar";

const SAMPLE = "Hi, I’m Polaris! You’re 80 percent of the way to your emergency fund. Nice work.";

/** Settings card: choose the voice Polaris reads answers with, and hear a sample. */
export function PolarisVoiceSettings() {
  const voices = useVoices();
  const [choice, setChoice] = useState<string>(() => readVoicePreference() ?? "");
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => { if (canSpeak) window.speechSynthesis.cancel(); }, []);

  if (!canSpeak) {
    return <Card>
      <h3 className="font-bold text-stone-900">Polaris voice</h3>
      <p className="text-sm text-stone-600">This browser can’t read answers aloud. Try Chrome, Edge, or Safari.</p>
    </Card>;
  }

  // A saved voice that's no longer installed falls back to automatic.
  const saved = voices.some(v => v.voiceURI === choice) ? choice : "";
  const best = voices[0];

  function choose(voiceURI: string) {
    setChoice(voiceURI);
    saveVoicePreference(voiceURI || null);
    preview(voiceURI);
  }
  function preview(voiceURI = saved) {
    const voice = voices.find(v => v.voiceURI === voiceURI) ?? best ?? null;
    const utterance = speakAsPolaris(SAMPLE, voice);
    setPlaying(true);
    utterance.onend = utterance.onerror = () => setPlaying(false);
  }
  function stop() {
    window.speechSynthesis.cancel();
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
        onChange={e => choose(e.target.value)}
        disabled={!voices.length}
      >
        <option value="">{best ? `Automatic (${best.name})` : "Loading voices…"}</option>
        {voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}
      </select>
      <button
        type="button"
        onClick={() => (playing ? stop() : preview())}
        disabled={!voices.length}
        aria-label={playing ? "Stop the sample" : "Hear a sample"}
        className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-stone-100 px-4 text-sm font-bold text-stone-800 ring-1 ring-stone-300 hover:bg-stone-200 disabled:opacity-50"
      >
        {playing ? <Square className="h-4 w-4" fill="currentColor" aria-hidden="true" /> : <Volume2 className="h-4 w-4" aria-hidden="true" />}
        {playing ? "Stop" : "Hear it"}
      </button>
    </div>
    <p className="mt-2 text-xs text-stone-600">
      Friendliest voices are listed first. Microsoft Edge has the most natural ones. On a Mac, you can download better voices in System Settings → Accessibility → Spoken Content → System voice → Manage Voices.
    </p>
  </Card>;
}
