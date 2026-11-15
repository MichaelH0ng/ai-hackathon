import { useEffect, useRef } from "react";
import { Mic } from "lucide-react";

const BARS = 5;
// Frequency bins (of 128) each bar follows; the middle bars take the voice's strongest range.
const BANDS: [number, number][] = [[2, 5], [5, 10], [3, 8], [10, 20], [20, 40]];
// Middle bars reach highest, like a voice meter.
const SHAPE = [0.55, 0.85, 1, 0.85, 0.55];
const GAIN = 2.4;
const FLOOR = 0.18; // bars never fully disappear while listening

/**
 * Square mic button. While `listening`, the mic icon becomes five bars that rise and fall
 * with how loudly you're speaking (read from the microphone with an AnalyserNode).
 */
export function MicLevelButton({ listening, disabled, onClick }: { listening: boolean; disabled?: boolean; onClick: () => void }) {
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    if (!listening) return undefined;
    const Ctx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx || !navigator.mediaDevices?.getUserMedia) return undefined;
    let alive = true;
    let raf = 0;
    let stream: MediaStream | null = null;
    const ctx = new Ctx();
    const levels = new Array<number>(BARS).fill(0);

    navigator.mediaDevices.getUserMedia({ audio: true }).then(s => {
      if (!alive) { s.getTracks().forEach(t => t.stop()); return; }
      stream = s;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      ctx.createMediaStreamSource(s).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const frame = () => {
        analyser.getByteFrequencyData(buf);
        BANDS.forEach(([lo, hi], i) => {
          let sum = 0;
          for (let b = lo; b < hi; b += 1) sum += buf[b];
          const target = Math.min(1, (sum / ((hi - lo) * 255)) * GAIN);
          // Rise fast, fall slowly, so the bars feel alive rather than jittery.
          levels[i] += (target - levels[i]) * (target > levels[i] ? 0.6 : 0.15);
          const bar = barRefs.current[i];
          if (bar) bar.style.transform = `scaleY(${FLOOR + (1 - FLOOR) * levels[i] * SHAPE[i]})`;
        });
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    }).catch(() => { /* no mic access: the bars stay at rest, and speech recognition reports the error */ });

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach(t => t.stop());
      void ctx.close(); // the bars unmount when listening stops, so nothing to reset
    };
  }, [listening]);

  return <button
    type="button"
    className={`money-assistant-mic${listening ? " listening" : ""}`}
    aria-pressed={listening}
    aria-label={listening ? "Stop listening" : "Ask with your voice"}
    title={listening ? "Tap to stop" : "Tap to talk"}
    disabled={disabled}
    onClick={onClick}
  >
    {listening
      ? <span className="money-assistant-mic-bars" aria-hidden="true">
        {Array.from({ length: BARS }, (_, i) => <span key={i} ref={el => { barRefs.current[i] = el; }} />)}
      </span>
      : <Mic size={18} aria-hidden="true" />}
  </button>;
}
