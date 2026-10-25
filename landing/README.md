# Ray — Keep the connection. Lose the legwork.

A new landing page built from the user-supplied 21st.dev **Cinematic Landing Hero** prompt on `codex/ray-cinematic`, branched from `demo`. The previous landing implementation, styles, fonts, icons, and demonstration documents were removed. Only the React/Vite/TypeScript/Tailwind project configuration and existing hosting identity were retained.

## Run

From the repository root:

```sh
npm ci --prefix landing
npm run dev --prefix landing -- --port 4174
npm run build --prefix landing
npm run preview --prefix landing -- --port 4175
```

## The experience

A full-viewport GSAP timeline pins the page as a physical blue card rises, fills the screen, and reveals a 3D phone. Scrolling reveals Discord messages and advances six connected chapters:

1. Maya wants AI/ML; Arjun wants databases and cannot attend Monday/Wednesday 9 AM–noon; Nina wants software engineering and prefers mornings; Leo wants AI/ML and afternoons, with Tuesday/Thursday morning work exclusions.
2. Arjun uses `/ask` and tags Ray to discover database courses.
3. A professor-review question produces teaching, coursework and workload themes.
4. A CSE 573 syllabus question returns topics, grading, assessments and a source excerpt.
5. `/plan recommend` creates four preference profiles. Maya, Arjun and Nina share CSE 510, 572 and 573; Leo shares 572 and 573, with afternoon CSE 564 replacing morning CSE 510. The response explicitly explains Nina's soft-preference tradeoff and both hard schedule constraints.
6. Students talk in a Discord voice channel, call Ray by name, ask about a course project, and request recommendations.

The phone moves between sides as chapters change. The final physical-card pullback reveals the live-demo CTA. Chapter controls sit outside the Discord screen. Inside the screen there are only normal chat messages, source links, the normal composer, and voice-channel UI.

**The illustration is driven by scroll position.** Stopping scrolling holds the current conversation; scrolling backward revisits earlier messages. Source links open clearly labeled demonstration excerpts. No on-page conversation invokes the bot or records microphone input. Voice playback starts only when the user unmutes the illustrated microphone.

The header's Read mode provides an unpinned layout with complete conversations and a voice transcript. The voice scene plays a generated 102-second conversation with five distinct ElevenLabs voices, synchronized speaker highlights and captions. The microphone is a play/pause control; the red hang-up control stops and resets the recording. Opening a spoken source pauses playback. Audio also pauses when leaving the voice chapter or hiding the tab. Replaying uses the bundled audio file and makes no ElevenLabs API calls. OS reduced-motion preferences select it by default. Chat transcripts remain keyboard-focusable and scrollable.

## Live demo

Select **Demo setup** in the footer, or **Meet Ray** before a link is configured. Save a real Discord channel or invite link; it is stored only in that browser. Subsequent Meet Ray buttons open it. The guide includes the actual `/ask` and `/plan recommend` commands from the bot on the `demo` branch. Voice is presented as an implemented capability, as confirmed by the user; run the voice-enabled bot for the live demonstration.

## Source

- `src/components/ui/cinematic-landing-hero.tsx`: expanding-card and phone timeline, chapter navigation, reduced-motion reading layout.
- `src/components/ui/discord.tsx`: plain Discord chat, phone hardware, voice channel.
- `src/data/story.tsx`: the six chat scripts and source excerpts.
- `src/data/voice.ts`: readable audio cues synchronized to the generated recording.
- `src/data/voice-scenario.json`: generated cue metadata imported from the source tree, following Vite asset rules.
- `public/assets/voice/scenario.json`: measured timestamps, script, sources and voice assignments.
- `public/assets/voice/ray-group-call.m4a`: the generated group conversation.
- `src/App.tsx`: navigation, source dialogs, motion mode and live-demo setup.
- `src/styles.css`: a new black, deep-blue, white, silver-blue and gold visual system.
- `public/assets/ray-icon.png`: the exact user-supplied `Ray_Icon.png`, used for the webpage, favicon and every Ray avatar.

The project supports React, TypeScript, Tailwind v4 and shadcn aliases. UI components live in `src/components/ui` (`@/components/ui`), styles in `src/styles.css`, and the `cn` helper in `src/lib/utils.ts`. `components.json` is ready for future shadcn components; no setup CLI is required.

## Demonstration data

All student dialogue, section times, review summaries, and grading details are scripted example data. Professor Rivera is fictional. The source inspector states this explicitly. The page demonstrates Ray's interaction flow; live catalog, review, syllabus and recommendation results come from the real bot.

## Publishing

The existing `.openai/hosting.json` Site identity is preserved. `landing/` contains the editable page; `sites/ray-landing/` is the ignored publishing checkout. Synchronize source without replacing its `.git/`, run the Sites source workflow, and preserve the current access configuration. `dist/` is the build output.

## Generate the voice scene

The generation script reads `ELEVENLABS_API_KEY` from the process environment or the repository root `.env`. The key is never included in the frontend or saved in output assets.

```sh
python3 landing/scripts/generate-voice-demo.py
```

This is an explicit, potentially billable authoring operation, not a browser request. Completed speech turns are cached by text, model, voice and settings under the ignored `.local/ray-voice-generation/` folder. Unchanged turns reuse that cache. The script balances the speakers with peak-safe per-turn level matching, combines 24kHz PCM turns with measured cue boundaries, then uses macOS `afconvert` for compact AAC; it falls back to WAV when no AAC encoder is available. Rebuild the page after regenerating audio.

Maya uses Matilda; Nina uses Sarah; Arjun uses Will; Leo uses Chris; Ray uses the playful, bright Jessica voice with more expressive delivery. These are stock ElevenLabs voices, not imitations of real students. The course, review, and syllabus details remain explicitly illustrative.

## Annotation changes

The six-word headline emphasizes human connection and less research work. Supporting copy, labels and chat text are larger. The eyebrow class was renamed from `overline` to avoid accidentally enabling Tailwind's overline text decoration.
