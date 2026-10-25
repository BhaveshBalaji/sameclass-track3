"use client";

// Rebuilt directly from the user-supplied 21st.dev Cinematic Landing Hero.
// The pinned timeline, expanding physical card, 3D phone entrance, material
// lighting and card pullback follow that component. Ray's six chapters replace
// the recovery dashboard; chat content itself stays plain Discord messages.
import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowDown, ArrowUpRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { chapters, voiceLines } from "@/data/story";
import { Chat, Phone, RayIcon, Voice } from "./discord";

gsap.registerPlugin(ScrollTrigger);
const CHAPTER_START = 3.2;
const CHAPTER_LENGTH = 3.4;
const STORY_END = CHAPTER_START + chapters.length * CHAPTER_LENGTH;
type Frame = {
  chapter: number;
  visible: number;
  beat: number;
  phase: "intro" | "story" | "outro";
};
const initialFrame: Frame = { chapter: 0, visible: 1, beat: 0, phase: "intro" };
export interface CinematicHeroProps {
  reading?: boolean;
  className?: string;
  onDemo: () => void;
}

export function CinematicHero({
  reading = false,
  className,
  onDemo,
}: CinematicHeroProps) {
  const root = useRef<HTMLDivElement>(null);
  const timeline = useRef<gsap.core.Timeline | null>(null);
  const [frame, setFrame] = useState<Frame>(initialFrame);
  const [scrollHint, setScrollHint] = useState(true);
  useLayoutEffect(() => {
    if (reading) return;
    const element = root.current;
    if (!element) return;
    let resizeFrame = 0;
    const setSize = () =>
      element.style.setProperty(
        "--phone-scale",
        String(
          Math.min(
            innerWidth < 760 ? 0.83 : 1,
            (innerHeight - (innerWidth < 760 ? 265 : 190)) / 680,
          ),
        ),
      );
    setSize();
    const media = gsap.matchMedia();
    media.add(
      { mobile: "(max-width: 759px)", desktop: "(min-width: 760px)" },
      (context) => {
        const mobile = Boolean(context.conditions?.mobile);
        const ctx = gsap.context(() => {
          const w = () => innerWidth;
          const h = () => innerHeight;
          const position = (index: number) =>
            mobile ? 0 : (index % 2 === 0 ? 1 : -1) * w() * 0.205;
          gsap.set(".main-card", {
            y: h() + 200,
            width: mobile ? "92vw" : "85vw",
            height: mobile ? "92svh" : "85svh",
            borderRadius: mobile ? 32 : 40,
            autoAlpha: 1,
          });
          gsap.set(".hero-line-one", {
            autoAlpha: 0,
            y: 60,
            scale: 0.85,
            filter: "blur(20px)",
            rotationX: -20,
          });
          gsap.set(".hero-line-two", {
            autoAlpha: 1,
            clipPath: "inset(0 100% 0 0)",
          });
          gsap.set(
            [
              ".chapter-copy",
              ".card-right-text",
              ".mockup-scroll-wrapper",
              ".chapter-navigation",
            ],
            { autoAlpha: 0 },
          );
          gsap.set(".closing-wrapper", {
            autoAlpha: 0,
            scale: 0.8,
            filter: "blur(30px)",
          });
          gsap
            .timeline({ defaults: { ease: "expo.out" } })
            .to(".hero-line-one", {
              duration: 1.4,
              autoAlpha: 1,
              y: 0,
              scale: 1,
              filter: "blur(0px)",
              rotationX: 0,
            })
            .to(
              ".hero-line-two",
              { duration: 1.3, clipPath: "inset(0 0% 0 0)" },
              0.45,
            )
            .fromTo(
              ".intro-detail",
              { y: 15, autoAlpha: 0 },
              { y: 0, autoAlpha: 1, duration: 0.8, stagger: 0.1 },
              0.8,
            );
          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: element,
              start: "top top",
              end: () => `+=${(mobile ? 1400 : 1700) * chapters.length + 2200}`,
              pin: true,
              scrub: 0.65,
              anticipatePin: 1,
              invalidateOnRefresh: true,
            },
            onUpdate: () => {
              const t = tl.time();
              const index = Math.max(
                0,
                Math.min(5, Math.floor((t - CHAPTER_START) / CHAPTER_LENGTH)),
              );
              const progress = Math.max(
                0,
                Math.min(
                  1,
                  (t - (CHAPTER_START + index * CHAPTER_LENGTH) - 0.28) /
                    (CHAPTER_LENGTH - 0.75),
                ),
              );
              const visible = Math.max(
                1,
                Math.ceil(progress * chapters[index].lines.length),
              );
              const beat = Math.min(
                voiceLines.length - 1,
                Math.floor(progress * voiceLines.length),
              );
              const phase =
                t < 2.2 ? "intro" : t > STORY_END + 0.4 ? "outro" : "story";
              setFrame((old) =>
                old.chapter === index &&
                old.visible === visible &&
                old.beat === beat &&
                old.phase === phase
                  ? old
                  : { chapter: index, visible, beat, phase },
              );
              setScrollHint(t < 0.1);
            },
          });
          timeline.current = tl;
          tl.to(
            ".hero-text-wrapper",
            {
              scale: 1.15,
              filter: "blur(20px)",
              opacity: 0.1,
              duration: 1.5,
              ease: "power2.inOut",
            },
            0,
          )
            .to(".main-card", { y: 0, duration: 1.45, ease: "power3.inOut" }, 0)
            .to(
              ".main-card",
              {
                width: "100vw",
                height: "100svh",
                borderRadius: 0,
                duration: 1,
                ease: "power3.inOut",
              },
              1.4,
            )
            .fromTo(
              ".mockup-scroll-wrapper",
              {
                y: 300,
                z: -500,
                rotationX: 50,
                rotationY: -30,
                scale: 0.6,
                autoAlpha: 0,
              },
              {
                y: 0,
                z: 0,
                rotationX: 0,
                rotationY: 0,
                scale: 1,
                autoAlpha: 1,
                duration: 1.4,
                ease: "expo.out",
              },
              1.7,
            )
            .to(
              ".device-axis",
              {
                x: () => position(0),
                rotationY: 0,
                rotationZ: mobile ? 0 : -3,
                duration: 1.4,
                ease: "power3.inOut",
              },
              1.8,
            )
            .fromTo(
              ".chapter-copy",
              { x: -45, autoAlpha: 0 },
              { x: 0, autoAlpha: 1, duration: 0.8, ease: "power3.out" },
              2.35,
            )
            .to(".card-identity", { autoAlpha: 0, duration: 0.35 }, 1.65)
            .to(".card-right-text", { autoAlpha: 1, duration: 1 }, 2.5)
            .to(".chapter-navigation", { autoAlpha: 1, duration: 0.5 }, 2.8);
          chapters.forEach((chapter, i) => {
            const start = CHAPTER_START + i * CHAPTER_LENGTH;
            tl.addLabel(chapter.id, start + 0.45);
            if (i > 0) {
              tl.to(
                ".chapter-copy",
                { autoAlpha: 0, y: -20, duration: 0.22, ease: "power2.in" },
                start - 0.28,
              )
                .to(
                  ".mockup-scroll-wrapper",
                  { autoAlpha: 0.1, scale: 0.92, duration: 0.25 },
                  start - 0.26,
                )
                .to(
                  ".device-axis",
                  {
                    x: () => position(i),
                    rotationY: 0,
                    rotationZ: mobile ? 0 : i % 2 === 0 ? -3 : 3,
                    duration: 0.85,
                    ease: "power3.inOut",
                  },
                  start - 0.2,
                )
                .to(
                  ".mockup-scroll-wrapper",
                  {
                    autoAlpha: 1,
                    scale: 1,
                    duration: 0.55,
                    ease: "power3.out",
                  },
                  start + 0.05,
                )
                .fromTo(
                  ".chapter-copy",
                  { y: 22 },
                  { autoAlpha: 1, y: 0, duration: 0.55, ease: "power3.out" },
                  start + 0.14,
                );
            }
            // Give the final message room to be read before the next transition.
            tl.to({}, { duration: 0.1 }, start + CHAPTER_LENGTH - 0.35);
          });
          tl.to(
            [".mockup-scroll-wrapper", ".chapter-copy", ".card-right-text"],
            {
              scale: 0.85,
              y: -40,
              z: -200,
              autoAlpha: 0,
              duration: 0.7,
              ease: "power3.in",
            },
            STORY_END,
          )
            .to(
              ".chapter-navigation",
              { autoAlpha: 0, duration: 0.3 },
              STORY_END,
            )
            .set(".hero-text-wrapper", { autoAlpha: 0 }, STORY_END)
            .set(".closing-wrapper", { autoAlpha: 1 }, STORY_END + 0.25)
            .to(
              ".card-identity",
              { autoAlpha: 1, duration: 0.55 },
              STORY_END + 0.3,
            )
            .to(
              ".main-card",
              {
                width: mobile ? "92vw" : "85vw",
                height: mobile ? "92svh" : "85svh",
                borderRadius: mobile ? 32 : 40,
                duration: 1.1,
                ease: "expo.inOut",
              },
              STORY_END + 0.6,
            )
            .to(
              ".closing-wrapper",
              {
                scale: 1,
                filter: "blur(0px)",
                duration: 1.1,
                ease: "expo.inOut",
              },
              STORY_END + 0.6,
            )
            .to(
              ".main-card",
              { y: () => -h() - 300, duration: 1, ease: "power3.in" },
              STORY_END + 1.75,
            )
            .to({}, { duration: 1 }, STORY_END + 2.75);
        }, element);
        return () => {
          ctx.revert();
          timeline.current = null;
        };
      },
    );
    const resize = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(setSize);
    };
    window.addEventListener("resize", resize);
    return () => {
      media.revert();
      cancelAnimationFrame(resizeFrame);
      window.removeEventListener("resize", resize);
    };
  }, [reading]);

  const jump = (index: number) => {
    const st = timeline.current?.scrollTrigger;
    if (st)
      window.scrollTo({
        top: st.labelToScroll(chapters[index].id),
        behavior: "smooth",
      });
  };
  const startStory = () => jump(0);
  const chapter = chapters[frame.chapter];
  if (reading)
    return (
      <div className="reading-experience">
        <div className="reading-intro">
          <RayIcon />
          <p className="overline">RAY / A SEMESTER, TOGETHER</p>
          <h1>
            Your people.
            <br />
            <span>Your semester.</span>
          </h1>
          <p>Six moments. One group conversation.</p>
        </div>
        {chapters.map((chapter, i) => (
          <section className="reading-chapter" id={chapter.id} key={chapter.id}>
            <div className="reading-copy">
              <span className="overline">
                0{i + 1} / {chapter.label}
              </span>
              <h2>{chapter.title}</h2>
              <p>{chapter.description}</p>
            </div>
            <Phone>
              {i === 5 ? (
                <Voice beat={2} reading />
              ) : (
                <Chat
                  lines={chapter.lines}
                  visible={chapter.lines.length}
                  reading
                />
              )}
            </Phone>
            {i === 5 && (
              <div className="reading-voice-transcript">
                {voiceLines.map((line, i) => (
                  <p key={i}>
                    <b>{line.person}:</b> {line.text}
                  </p>
                ))}
              </div>
            )}
          </section>
        ))}
        <div className="reading-outro">
          <h2>
            Better plans.
            <br />
            <span>Made together.</span>
          </h2>
          <button className="btn-modern-light" onClick={onDemo}>
            Meet Ray in Discord <ArrowUpRight size={20} />
          </button>
        </div>
      </div>
    );
  return (
    <div
      ref={root}
      className={cn("cinematic-experience", className)}
      data-chapter={frame.chapter}
      data-phase={frame.phase}
    >
      <div className="film-grain" aria-hidden="true" />
      <div className="bg-grid-theme" aria-hidden="true" />
      <div className="hero-text-wrapper">
        <p className="overline intro-detail">
          <span className="live-light" />
          YOUR DISCORD GROUP. ONE BRIGHTER SEMESTER.
        </p>
        <h1>
          <span className="hero-line-one text-3d-matte">Your people.</span>
          <span className="hero-line-two text-silver-matte">
            Your semester.
          </span>
        </h1>
        <p className="hero-description intro-detail">
          From “what should we take?” to a plan that fits.
          <br />
          Meet Ray in your group chat.
        </p>
        <button className="intro-detail start-experience" onClick={startStory}>
          SCROLL INTO THE CONVERSATION <ArrowDown size={18} />
        </button>
      </div>
      <div className="closing-wrapper">
        <RayIcon />
        <p className="overline">NOW, LET’S MAKE IT REAL.</p>
        <h2>
          Better plans.
          <br />
          <span>Made together.</span>
        </h2>
        <p>
          Same friends. Same Discord.
          <br />
          Research, recommendations, and a voice in the room.
        </p>
        <button className="btn-modern-light" onClick={onDemo}>
          Meet Ray in Discord <ArrowUpRight size={20} />
        </button>
        <button
          className="restart-link"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          Back to the beginning ↗
        </button>
      </div>
      <div className="card-stage">
        <div className="main-card premium-depth-card">
          <div className="card-sheen" aria-hidden="true" />
          <div className="card-identity" aria-hidden="true">
            <RayIcon />
            <span>RAY</span>
          </div>
          <div className="card-grid" aria-hidden="true" />
          <div className="card-ambient" aria-hidden="true" />
          <span className="card-right-text" aria-hidden="true">
            RAY
          </span>
          <div
            className={`chapter-copy ${frame.chapter % 2 === 0 ? "copy-left" : "copy-right"}`}
          >
            <p className="overline">
              0{frame.chapter + 1} / {chapter.eyebrow}
            </p>
            <h2>{chapter.title}</h2>
            <p className="chapter-description">{chapter.description}</p>
            <div className="chapter-aside">
              <span /> {chapter.aside}
            </div>
          </div>
          <div className="device-axis">
            <div className="mockup-scroll-wrapper">
              <div className="device-scale">
                <Phone>
                  {frame.chapter === 5 ? (
                    <Voice beat={frame.beat} />
                  ) : (
                    <Chat lines={chapter.lines} visible={frame.visible} />
                  )}
                </Phone>
              </div>
            </div>
          </div>
          <nav className="chapter-navigation" aria-label="Story chapters">
            {chapters.map((item, i) => (
              <button
                className={i === frame.chapter ? "active" : ""}
                key={item.id}
                aria-label={`Chapter ${i + 1}: ${item.label}`}
                aria-current={i === frame.chapter ? "step" : undefined}
                onClick={() => jump(i)}
              >
                <span>0{i + 1}</span>
                <b>{item.label}</b>
                <i />
              </button>
            ))}
            <span className="scroll-to-continue">
              SCROLL TO CONTINUE <ChevronDown size={13} />
            </span>
          </nav>
          <p className="scripted-label">
            SCRIPTED DEMONSTRATION · EXAMPLE COURSES, TIMES, REVIEWS & GRADING
          </p>
        </div>
      </div>
      {scrollHint && (
        <div className="scroll-indicator" aria-hidden="true">
          <span>THE STORY UNFOLDS AS YOU SCROLL</span>
          <div />
        </div>
      )}
    </div>
  );
}
