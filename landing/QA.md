# Verification — cinematic Ray landing page

October 25, 2026 · branch `codex/ray-cinematic`, based on `demo`.

- `npm run build --prefix landing` passes TypeScript and the production Vite build, without warnings.
- Production preview returns HTTP 200.
- Desktop hero, expanding physical card, alternating phone chapters, voice room, card exit and final CTA inspected in the browser.
- Desktop and mobile checks include 1126×827, 1280×720, 390×844 and 390×720. Mobile document width equals the 390px viewport, with no horizontal overflow.
- Scrolling over the mobile phone advances the page story. The transcript can also be scrolled to inspect earlier text.
- Scroll position drives chapter selection, message arrival and voice speaker/caption changes. Chapter navigation is operable outside the Discord interface.
- The database discovery scene presents CSE 510, 511 and 512 via `/ask`.
- Professor review and syllabus scenes are separate chapters. The syllabus citation opens its clearly labeled source inspector by both pointer and keyboard. The interactive screen is flattened within the 3D device to preserve correct hit testing.
- Recommendation text checked in the rendered DOM: four individual profiles; Maya/Arjun/Nina share 510/572/573; Leo shares 572/573 and gets 564. The example timetable respects the stated hard work exclusions; Nina's morning preference is identified as a tradeoff.
- Voice scene contains all four students and Ray; a rendered caption shows Arjun calling “Ray” and asking about the course project.
- Read mode successfully replaces the pinned story with all six chapters and a full voice transcript. GSAP uses layout-effect cleanup when switching modes.
- The final Meet Ray CTA opens demo setup. An unrelated URL is rejected; no fictional Discord channel was saved.
- SHA-256 of `public/assets/ray-icon.png` matches the user's original `Ray_Icon.png` exactly.
- The prior landing source, styles, fonts, icons and example PDFs were deleted. The bot source remains unchanged.

The on-page conversations, professor, section times, grading and source excerpts are illustrative data. These checks validate the presentation, not a live model call, real section availability, review retrieval, syllabus extraction, or voice transport.

## Annotation update

- Headline replaced with the six-word “Keep the connection. Lose the legwork.” in cinematic and reading modes.
- Removed the accidental Tailwind `overline` decoration by renaming the class to `eyebrow`; computed decoration is `none`.
- Desktop explanation copy is 20px in the hero and 18px in chapters, with 12px eyebrow labels and 14px supporting asides. Chat text, navigation, source dialogs and mobile copy were enlarged as well.
- Chapter text uses a separate centering wrapper so GSAP motion does not displace the larger copy into the navigation.
- Generated 12 speech turns with five verified stock ElevenLabs voices, measured cue boundaries and peak-safe level matching. Browser-loaded duration is 102.4 seconds.
- Browser verified mic play, pause and resume; audio-synchronized captions and speaker highlights; a source click pausing playback and opening its inspector; and the complete recording reaching the final Arjun response with status `ended`.
- The generation key is absent from frontend source and output assets. Playback uses a static AAC file and does not make ElevenLabs requests or record microphone input.

## Pre-merge repository checks

Python: Ruff passes; 53 tests pass (one upstream Starlette deprecation warning).
Bot: TypeScript/build, the main test suite, planning tests, group tests, database checks and deterministic replay pass against an isolated local PostgreSQL test database.
The existing video helper's lint-only formatting fix preserves its normalized syntax tree.
