"""Generate the scripted group call with ElevenLabs. The key never enters web assets.

Uses only Python's standard library; completed turns are cached outside the source
checkout so rerunning a successful generation does not spend credits again.
"""

from array import array
import math
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
import wave

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".local/ray-voice-generation"
OUT = ROOT / "landing/public/assets/voice"
CACHE.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

# IDs were verified against the account's /v2/voices response.
VOICES = {
    "Nina": ("EXAVITQu4vr4xnSDxMaL", "Sarah"),
    "Maya": ("XrExE9yKIg1WjnnlVkGX", "Matilda"),
    "Arjun": ("bIHbv24MWmeRgasZH58o", "Will"),
    "Leo": ("iP95p4xoKVk53GoZ742B", "Chris"),
    "Ray": ("cgSgspJ2msm6clMCkdW9", "Jessica"),
}
TURNS = [
    (
        "Nina",
        "Okay, Spring twenty twenty-seven. I'd love software engineering courses, preferably in the morning. What about everyone else?",
        [],
    ),
    (
        "Maya",
        "I'm into AI and machine learning. I want classes where we actually build something we could put in our portfolios.",
        [],
    ),
    ("Arjun", "Databases for me. And I can't do Mondays or Wednesdays from nine until noon.", []),
    (
        "Leo",
        "AI and machine learning too. Afternoons are best. I work Tuesday and Thursday mornings, so those are completely out.",
        [],
    ),
    (
        "Maya",
        "Hey Ray, can you suggest what classes we should take for Spring twenty twenty-seven based on our preferences?",
        [],
    ),
    (
        "Ray",
        "Absolutely! I can see a lot of common ground here. I'd start with C S E five seventy-two, Data Mining, and five seventy-three, Semantic Web Mining, for all four of you.",
        ["catalog"],
    ),
    (
        "Ray",
        "The catalog connects these courses to your AI and data interests. In our example syllabus, five seventy-three includes an agentic AI group project. That gives you something practical to build together!",
        ["catalog", "syllabus"],
    ),
    (
        "Ray",
        "Maya, Arjun, and Nina, add C S E five ten for database systems. Arjun gets the database depth, and Nina gets useful backend engineering experience.",
        ["catalog"],
    ),
    (
        "Ray",
        "Leo, that morning section conflicts with work, so choose the afternoon software design course, C S E five sixty-four, instead. You still share two classes with everyone.",
        ["catalog"],
    ),
    (
        "Ray",
        "Professor review themes describe hands-on work and a demanding project. Start early, and treat those reviews as student experiences. Check the linked catalog, syllabus, and reviews before deciding.",
        ["reviews", "syllabus", "catalog"],
    ),
    (
        "Nina",
        "I'm okay trading two mornings for classes with everyone. Let's check the sections and choose together.",
        [],
    ),
    ("Arjun", "Exactly. Ray does the research; we make the decision.", []),
]


def key_from_environment():
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        for line in (ROOT / ".env").read_text().splitlines():
            name, sep, value = line.partition("=")
            if sep and name.strip() == "ELEVENLABS_API_KEY":
                key = value.strip().strip("\"'")
    if not key:
        raise SystemExit("Set ELEVENLABS_API_KEY in the environment or the root .env file.")
    return key


def generate(index, key):
    person, text, sources = TURNS[index]
    voice, voice_name = VOICES[person]
    payload = {
        "text": text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {
            "stability": 0.4 if person == "Ray" else 0.5,
            "similarity_boost": 0.75,
            "style": 0.6 if person == "Ray" else 0.25,
            "use_speaker_boost": True,
            "speed": 1.05,
        },
    }
    digest = hashlib.sha256(json.dumps([voice, payload], sort_keys=True).encode()).hexdigest()[:16]
    path = CACHE / f"{index:02}-{person.lower()}-{digest}.pcm"
    if not path.exists():
        request = urllib.request.Request(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=pcm_24000",
            data=json.dumps(payload).encode(),
            headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/pcm"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                audio = response.read()
            if len(audio) < 1000 or len(audio) % 2:
                raise RuntimeError("Unexpected PCM response length")
            path.write_bytes(audio)
        except urllib.error.HTTPError as error:
            raise RuntimeError(
                f"ElevenLabs returned HTTP {error.code}; no automatic generation retry was attempted."
            ) from None
    print(f"{index + 1:02}/{len(TURNS)} {person} ({voice_name}): {len(path.read_bytes()) / 48000:.1f}s", flush=True)
    return index, path


def main():
    print(f"Voice demo: {len(TURNS)} turns, {sum(len(t[1]) for t in TURNS)} characters, 5 distinct voices.", flush=True)
    key = key_from_environment()
    paths = dict([generate(0, key)])
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        pending = [pool.submit(generate, index, key) for index in range(1, len(TURNS))]
        for future in concurrent.futures.as_completed(pending):
            index, path = future.result()
            paths[index] = path
    gap = b"\x00\x00" * 6000  # 250 ms of natural space between turns.
    samples = bytearray(b"\x00\x00" * 2400)
    cues = []
    for index, (person, text, sources) in enumerate(TURNS):
        raw = paths[index].read_bytes()
        values = array("h", raw)
        if sys.byteorder != "little":
            values.byteswap()
        rms = math.sqrt(sum(sample * sample for sample in values) / len(values)) / 32768
        peak = max(abs(sample) for sample in values) / 32768
        gain = min(0.09 / max(rms, 1e-9), 0.94 / max(peak, 1e-9))
        balanced = array("h", (round(sample * gain) for sample in values))
        if sys.byteorder != "little":
            balanced.byteswap()
        raw = balanced.tobytes()
        start = len(samples) / 48000
        samples.extend(raw)
        end = len(samples) / 48000
        cues.append(
            {"person": person, "text": text, "sources": sources, "start": round(start, 4), "end": round(end, 4)}
        )
        samples.extend(gap)
    wav_path = CACHE / "ray-group-call.wav"
    with wave.open(str(wav_path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(24000)
        output.writeframes(bytes(samples))
    target = OUT / "ray-group-call.m4a"
    if shutil.which("afconvert"):
        result = subprocess.run(
            ["afconvert", "-f", "m4af", "-d", "aac@44100", "-b", "96000", str(wav_path), str(target)],
            capture_output=True,
        )
        if result.returncode:
            target = OUT / "ray-group-call.wav"
            shutil.copy2(wav_path, target)
            print("AAC encoder unavailable; using the browser-compatible WAV source.", flush=True)
    else:
        target = OUT / "ray-group-call.wav"
        shutil.copy2(wav_path, target)
    manifest = {
        "audio": target.name,
        "duration": round(len(samples) / 48000, 4),
        "provider": "ElevenLabs",
        "mastering": "Per-turn peak-safe level matching",
        "model": "eleven_multilingual_v2",
        "voices": {name: voice[1] for name, voice in VOICES.items()},
        "cues": cues,
        "note": "Scripted illustrative scenario; course times, reviews and syllabus details are example data.",
    }
    serialized = json.dumps(manifest, indent=2) + "\n"
    (OUT / "scenario.json").write_text(serialized)
    (ROOT / "landing/src/data/voice-scenario.json").write_text(serialized)
    print(
        f"Complete: {manifest['duration']:.1f}s, {target.stat().st_size / 1024:.0f} KiB. No key written to output.",
        flush=True,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Voice generation stopped: {error}", file=sys.stderr)
        sys.exit(1)
