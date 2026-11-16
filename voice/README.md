# Polaris "Michael" voice (optional, local only)

Polaris can read answers in a cloned voice using [OpenVoice V2](https://github.com/myshell-ai/OpenVoice)
and [MeloTTS](https://github.com/myshell-ai/MeloTTS) (both MIT-licensed). Everything runs on your own
computer at `127.0.0.1:8790`; no audio or text leaves it.

**Without this setup nothing breaks.** `npm run dev` prints "Michael voice not set up" and the
"Michael" option in Settings uses a deep built-in browser voice instead.

## What's in git and what isn't

| Path | In git? | What |
|---|---|---|
| `voice/server.py` | yes | The voice service (`npm run dev` starts it via `scripts/voice.mjs`) |
| `voice/vendor/` | no | OpenVoice, MeloTTS, and model checkpoints (downloads) |
| `voice/samples/` | no | The voice recording |
| `voice/speaker/me.pth` | no | The voice fingerprint made from the recording |
| `voice/cache/tts/` | no | Generated audio, cached by sentence |

Treat the recording and `me.pth` like a password: with them, anyone can make that voice say anything.

## Setup (macOS, Apple Silicon)

```sh
conda create -y -n northstar-voice python=3.10
PY=/opt/anaconda3/envs/northstar-voice/bin/python    # or set VOICE_PYTHON to your env's python
git clone --depth 1 https://github.com/myshell-ai/OpenVoice.git voice/vendor/OpenVoice
git clone --depth 1 https://github.com/myshell-ai/MeloTTS.git voice/vendor/MeloTTS
$PY -m pip install torch torchaudio
# Both projects pin old versions that don't build on Apple Silicon: install them without their pins.
$PY -m pip install --no-deps -e voice/vendor/OpenVoice -e voice/vendor/MeloTTS
$PY -m pip install "numpy<2" "librosa==0.10.2.post1" pydub wavmark eng_to_ipa "inflect==7.0.0" unidecode \
  faster-whisper whisper-timestamped pypinyin cn2an jieba langid soundfile txtsplit cached_path \
  "transformers==4.27.4" "num2words==0.5.12" unidic_lite "unidic==1.1.0" mecab-python3 pykakasi fugashi \
  "g2p_en==2.1.0" anyascii jamo "gruut==2.2.3" g2pkk loguru
$PY -m unidic download
# The S3 link in OpenVoice's docs is gone; the same checkpoints are on MyShell's Hugging Face page.
$PY -c "from huggingface_hub import snapshot_download; snapshot_download('myshell-ai/OpenVoiceV2', local_dir='voice/vendor/checkpoints_v2')"
```

Then record about 45 to 60 seconds of natural speech (quiet room, normal pace) to
`voice/samples/me.m4a` and make the fingerprint:

```sh
mkdir -p voice/speaker voice/cache/clips
ffmpeg -y -i voice/samples/me.m4a -af "silenceremove=stop_periods=-1:stop_duration=0.4:stop_threshold=-40dB" \
  -f segment -segment_time 8 -ac 1 -ar 22050 voice/cache/clips/clip_%02d.wav
$PY -c "
import glob, os
from openvoice.api import ToneColorConverter
c = ToneColorConverter('voice/vendor/checkpoints_v2/converter/config.json', device='cpu')
c.load_ckpt('voice/vendor/checkpoints_v2/converter/checkpoint.pth')
c.extract_se(sorted(glob.glob('voice/cache/clips/*.wav')), se_save_path='voice/speaker/me.pth')"
```

Restart `npm run dev`. The first start takes about 10 seconds; after that each sentence takes about a second.

## Tuning

`SPEED` and the `WARM` filter at the top of `voice/server.py` set the sound (slightly slower, a little more
low-mid body, softer highs). Change `VERSION` after tuning so cached clips are regenerated.
