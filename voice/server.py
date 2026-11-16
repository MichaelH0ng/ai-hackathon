"""NorthStar's local voice service: reads text aloud in a cloned voice ("Michael").

Runs on this computer only (127.0.0.1). The NorthStar API forwards Polaris's "Listen" requests here.
Setup and the voice recording are described in voice/README.md. Start it with `npm run dev`.

  GET  /health          -> {"ready": true}
  POST /speak {"text"}  -> audio/wav of that text (one or two sentences at a time)
"""
import hashlib
import json
import os
import re
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import torch  # noqa: E402
from melo.api import TTS  # noqa: E402
from openvoice.api import ToneColorConverter  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
CKPT = os.path.join(HERE, "vendor", "checkpoints_v2")
SPEAKER = os.path.join(HERE, "speaker", "me.pth")
CACHE = os.path.join(HERE, "cache", "tts")
PORT = int(os.environ.get("VOICE_PORT", "8790"))
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"

# The chosen sound: a slightly slower pace and a warm EQ (a little more body, softer highs).
SPEED = 0.95
WARM = "equalizer=f=200:t=q:w=1.0:g=3,equalizer=f=4500:t=q:w=1.2:g=-2.5,highshelf=f=9000:g=-3,loudnorm=I=-18:TP=-2"
VERSION = f"v2|{SPEED}|{WARM}"  # change this to regenerate cached audio after tuning
MAX_CHARS = 600

os.makedirs(CACHE, exist_ok=True)
started = time.time()
converter = ToneColorConverter(os.path.join(CKPT, "converter", "config.json"), device=DEVICE)
converter.load_ckpt(os.path.join(CKPT, "converter", "checkpoint.pth"))
converter.watermark_model = None  # OpenVoice's demo watermark adds about a second per sentence
tts = TTS(language="EN_NEWEST", device=DEVICE)
speaker_id = tts.hps.data.spk2id["EN-Newest"]
source_se = torch.load(os.path.join(CKPT, "base_speakers", "ses", "en-newest.pth"), map_location=DEVICE)
target_se = torch.load(SPEAKER, map_location=DEVICE)
lock = threading.Lock()  # one model, one sentence at a time


def speakable(text: str) -> str:
    """Markdown and symbols out, money and percents in words the base voice reads naturally."""
    text = re.sub(r"[*_#`>]", "", text)
    text = re.sub(r"^\s*[-•]\s+", "", text, flags=re.M)
    text = re.sub(r"\$(\d[\d,]*)\.(\d\d)\b", lambda m: f"{m.group(1)} dollars and {int(m.group(2))} cents", text)
    text = re.sub(r"\$(\d[\d,]*)", r"\1 dollars", text)
    text = re.sub(r"(\d)%", r"\1 percent", text)
    text = text.replace("&", " and ").replace("−", "minus ")
    return re.sub(r"\s+", " ", text).strip()


def synthesize(text: str) -> bytes:
    key = hashlib.sha256(f"{VERSION}|{text}".encode()).hexdigest()
    cached = os.path.join(CACHE, f"{key}.wav")
    if os.path.exists(cached):
        with open(cached, "rb") as f:
            return f.read()
    with lock, tempfile.TemporaryDirectory() as tmp:
        base, plain = os.path.join(tmp, "base.wav"), os.path.join(tmp, "plain.wav")
        tts.tts_to_file(text, speaker_id, base, speed=SPEED, quiet=True)
        converter.convert(audio_src_path=base, src_se=source_se, tgt_se=target_se, output_path=plain)
        # loudnorm would upsample to 192 kHz; 24 kHz keeps each clip small and quick to load.
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", plain, "-af", WARM, "-ar", "24000", "-ac", "1", cached], check=True)
    with open(cached, "rb") as f:
        return f.read()


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: bytes, kind: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, value: dict) -> None:
        self._send(status, json.dumps(value).encode(), "application/json")

    def do_GET(self):  # noqa: N802
        if self.path == "/health":
            return self._json(200, {"ready": True, "device": DEVICE})
        self._json(404, {"error": "Not found"})

    def do_POST(self):  # noqa: N802
        if self.path != "/speak":
            return self._json(404, {"error": "Not found"})
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 16_384)
            text = speakable(str(json.loads(self.rfile.read(length) or b"{}").get("text", "")))[:MAX_CHARS]
        except (ValueError, json.JSONDecodeError):
            return self._json(400, {"error": "Send JSON like {\"text\": \"Hello\"}."})
        if not text:
            return self._json(400, {"error": "Nothing to say."})
        try:
            self._send(200, synthesize(text), "audio/wav")
        except Exception as err:  # keep the service up; the app falls back to a built-in voice
            print(f"voice: couldn't speak that ({type(err).__name__}: {err})", flush=True)
            self._json(500, {"error": "Couldn't make that audio."})

    def log_message(self, *args):  # requests contain Polaris answers: don't print them
        pass


if __name__ == "__main__":
    synthesize("Hi, I'm Polaris.")  # warm up now so the first Listen is quick
    print(f"Voice service on http://127.0.0.1:{PORT} ({DEVICE}, ready in {time.time() - started:.0f}s)", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
