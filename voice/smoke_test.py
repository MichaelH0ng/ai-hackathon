"""Quick check that local voice cloning works: base English speech, then OpenVoice's tone converter.

Run: /opt/anaconda3/envs/northstar-voice/bin/python voice/smoke_test.py [reference.wav]
With no reference it converts to a built-in voice; with one, to that voice.
"""
import os
import sys
import time

import torch

HERE = os.path.dirname(os.path.abspath(__file__))
CKPT = os.path.join(HERE, "vendor", "checkpoints_v2")
OUT = os.path.join(HERE, "cache", "smoke")
os.makedirs(OUT, exist_ok=True)

from melo.api import TTS  # noqa: E402
from openvoice import se_extractor  # noqa: E402
from openvoice.api import ToneColorConverter  # noqa: E402

device = os.environ.get("VOICE_DEVICE", "cpu")
t0 = time.time()
converter = ToneColorConverter(os.path.join(CKPT, "converter", "config.json"), device=device)
# Skip OpenVoice's inaudible watermark: it's for public demos and adds about a second per sentence.
# (Its enable_watermark=False option crashes in this version, so switch it off after loading.)
converter.watermark_model = None
converter.load_ckpt(os.path.join(CKPT, "converter", "checkpoint.pth"))
tts = TTS(language="EN_NEWEST", device=device)
speaker_id = list(tts.hps.data.spk2id.values())[0]
source_se = torch.load(os.path.join(CKPT, "base_speakers", "ses", "en-newest.pth"), map_location=device)
print(f"models loaded in {time.time() - t0:.1f}s")

reference = sys.argv[1] if len(sys.argv) > 1 else None
if reference:
    t0 = time.time()
    target_se, _ = se_extractor.get_se(reference, converter, vad=True)
    print(f"voice fingerprint from your sample in {time.time() - t0:.1f}s")
else:
    target_se = torch.load(os.path.join(CKPT, "base_speakers", "ses", "en-us.pth"), map_location=device)

sentences = [
    "Warming up.",
    "Hi, I'm Polaris.",
    "You spent two hundred and twelve dollars last week, about forty dollars less than usual.",
    "Your car fund is sixty two percent funded. Nice work!",
]
for i, text in enumerate(sentences):
    t0 = time.time()
    base = os.path.join(OUT, f"base_{i}.wav")
    tts.tts_to_file(text, speaker_id, base, speed=1.05, quiet=True)
    t1 = time.time()
    out = os.path.join(OUT, f"{'you' if reference else 'builtin'}_{i}.wav")
    converter.convert(audio_src_path=base, src_se=source_se, tgt_se=target_se, output_path=out, message="@NorthStar")
    print(f"sentence {i + 1}: speech {t1 - t0:.1f}s + your-voice conversion {time.time() - t1:.1f}s -> {out}")
