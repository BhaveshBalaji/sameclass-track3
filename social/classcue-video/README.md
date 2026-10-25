# ClassCue social video

A 28-second vertical demo for Instagram Reels or TikTok, created with HyperFrames and ElevenLabs.

## Deliverables

- `classcue-social-28s.mp4`: 1080 × 1920, 30 fps, H.264/AAC.
- `classcue-cover.png`: cover frame.
- `classcue-captions.srt`: synchronized narration captions (also burned into the video).
- `POST-CAPTION.txt`: suggested caption and bio links to set before posting.
- `index.html`, `captions.js`, `DESIGN.md`, and `assets/`: editable video source.

## Source and accuracy

The chat is a condensed recreation of the user-provided Cubbie conversation, with a crop of the original CSE 546 reply. Course names, times and review themes come from that example; they are not a new live verification. The crop excludes the student's unrelated assignments and calendar notes. The original full screenshot is not included in this project.

ClassCue repository: https://github.com/aniiishhh/cubbie-class-registration-buddy

ClassCue is a skill used by Cubbie, not a separate iMessage app. The example plans around ASU catalog information; current seat counts, prerequisites, degree approval and enrollment eligibility still require ASU verification. Review themes describe student opinions, not verified teaching policies. The video labels itself as a condensed demo.

## Audio

ElevenLabs Kelsey voice (`eleven_v4`) narrates the approved script. ElevenLabs generated the original instrumental bed, soft typing and message-pop sounds. Short swooshes and the closing chime are original synthesized cues. Word timings came from ElevenLabs Scribe. Two pauses were added to allow reading; captions use those adjusted timestamps.

Mixed loudness: approximately -16.5 LUFS integrated, with true peak below -2.5 dBTP before AAC encoding. Voice, music and effects were normalized and mixed independently.

## Edit and render

Requires Node 22+ and Python 3. Installed packages are pinned in `package-lock.json`. Local FFmpeg and FFprobe binaries are supplied by their npm packages; `tools/hyperframes.sh` puts them on PATH and uses the desktop's bundled Node runtime if the default Node is too old.

```sh
npm install
python3 prepare.py
npm run check
npm run render
```

`assets/voice.wav` contains the normalized speech with reading pauses. The raw ElevenLabs speech is `assets/narration.mp3`. Editing `prepare.py` regenerates captions, original synthesized cues and the final audio mix. `index.html` defines the visual timeline.

Use `npm run preview` for the HyperFrames Studio, or open the finished MP4 to review it.

## Publishing

The video has not been posted and no social account was created. Its call to action assumes installation and voting links have been placed in the account bio before posting. Use the direct ClassCue hackathon entry link when available.
