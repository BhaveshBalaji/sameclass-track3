import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Hash,
  Plus,
  Smile,
  Mic,
  MicOff,
  LoaderCircle,
  Headphones,
  Volume2,
  Video,
  PhoneOff,
  Signal,
  BatteryFull,
} from "lucide-react";
import { type ChatLine, type Person, SourceLink } from "@/data/story";
import { voiceCues, voiceScenario } from "@/data/voice";
export function RayIcon({ className = "" }: { className?: string }) {
  return (
    <img
      className={`ray-icon ${className}`}
      src="./assets/ray-icon.png"
      alt=""
      draggable={false}
    />
  );
}
export function Avatar({ person }: { person: Person }) {
  return (
    <span className={`avatar avatar-${person.toLowerCase()}`}>
      {person === "Ray" ? <RayIcon /> : person[0]}
    </span>
  );
}
export function Chat({
  lines,
  visible,
  reading = false,
}: {
  lines: ChatLine[];
  visible: number;
  reading?: boolean;
}) {
  const feed = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (feed.current && !reading)
      feed.current.scrollTop = feed.current.scrollHeight;
  }, [visible, lines, reading]);
  return (
    <>
      <div className="discord-header">
        <ArrowLeft size={21} />
        <Hash size={22} />
        <span>
          spring-planning<small>The study group</small>
        </span>
        <Headphones size={19} />
      </div>
      <div
        className="chat-feed"
        ref={feed}
        tabIndex={0}
        aria-label="Illustrative Discord conversation"
      >
        <div className="day-label">
          <span />
          Today
          <span />
        </div>
        {lines.slice(0, visible).map((line, i) => (
          <article
            className={`chat-message ${line.person === "Ray" ? "from-ray" : ""}`}
            key={i}
          >
            <Avatar person={line.person} />
            <div className="message-column">
              <div className="message-name">
                <strong>{line.person}</strong>
                {line.person === "Ray" && (
                  <span className="bot-label">APP</span>
                )}
                <time>
                  {line.command
                    ? "used " + line.command
                    : "4:" + String(20 + i).padStart(2, "0") + " PM"}
                </time>
              </div>
              <div className="message-body">{line.body}</div>
            </div>
          </article>
        ))}
        {visible < lines.length && (
          <div className="discord-typing">
            <i />
            <i />
            <i />
            <span>{lines[visible]?.person} is typing…</span>
          </div>
        )}
      </div>
      <div className="discord-compose">
        <Plus size={18} />
        <span>Message #spring-planning</span>
        <Smile size={18} />
      </div>
    </>
  );
}
export function Voice({
  reading = false,
  active = true,
}: {
  reading?: boolean;
  active?: boolean;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<
    "ready" | "loading" | "playing" | "paused" | "ended" | "error"
  >("ready");
  const [position, setPosition] = useState(0);
  const playing = status === "playing";
  const started = status !== "ready" && position > 0;
  const cue =
    voiceCues.find(
      (item, index) =>
        position >= item.start &&
        position < (voiceCues[index + 1]?.start ?? Infinity),
    ) || voiceCues[0];
  const stop = () => {
    const media = audio.current;
    if (!media) return;
    media.pause();
    media.currentTime = 0;
    setPosition(0);
    setStatus("ready");
  };
  const toggle = async () => {
    const media = audio.current;
    if (!media) return;
    if (!media.paused) {
      media.pause();
      return;
    }
    if (status === "error") media.load();
    if (media.ended) {
      media.currentTime = 0;
      setPosition(0);
    }
    setStatus("loading");
    try {
      await media.play();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setStatus("error");
    }
  };
  useEffect(() => {
    if (!active) audio.current?.pause();
  }, [active]);
  useEffect(() => {
    const media = audio.current;
    const visibility = () => {
      if (document.hidden) media?.pause();
    };
    document.addEventListener("visibilitychange", visibility);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) media?.pause();
      },
      { threshold: 0.1 },
    );
    if (panel.current) observer.observe(panel.current);
    return () => {
      media?.pause();
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  const sourceNames = {
    catalog: "Course catalog",
    syllabus: "Syllabus · p. 1",
    reviews: "RMP reviews",
  };
  return (
    <div className="discord-voice" ref={panel} data-playback={status}>
      <audio
        ref={audio}
        src={`./assets/voice/${voiceScenario.audio}`}
        preload="metadata"
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onPlaying={() => setStatus("playing")}
        onPause={(event) => {
          const ended = event.currentTarget.ended;
          setStatus((old) =>
            old === "ready" ? "ready" : ended ? "ended" : "paused",
          );
        }}
        onEnded={() => setStatus("ended")}
        onError={() => setStatus("error")}
      />
      <div className="discord-header">
        <ArrowLeft size={21} />
        <Volume2 size={21} />
        <span>
          The study room<small>Voice channel</small>
        </span>
      </div>
      <div className="voice-connected">
        <Signal size={12} />
        Voice connected
      </div>
      <div className="voice-grid">
        {(["Maya", "Arjun", "Nina", "Leo", "Ray"] as Person[]).map((person) => (
          <div
            key={person}
            className={`voice-member ${playing && cue.person === person ? "is-speaking" : ""}`}
          >
            <Avatar person={person} />
            <span>
              {person}
              {person === "Ray" && <b className="bot-label">APP</b>}
            </span>
            <Mic size={11} />
          </div>
        ))}
      </div>
      <div
        className={`voice-wave ${playing && !reading ? "is-playing" : ""}`}
        aria-hidden="true"
      >
        {Array.from({ length: 29 }, (_, i) => (
          <i
            key={i}
            style={{
              height: 8 + ((i * 13) % 31),
              animationDelay: `${i * 0.05}s`,
            }}
          />
        ))}
      </div>
      <div className="live-caption" role="status" aria-live="polite">
        <strong>{started ? cue.person : "Your group"}</strong>
        <p>
          {status === "error"
            ? "Audio couldn’t load. Tap the mic to try again."
            : !started
              ? "Unmute to hear the group plan Spring 2027 together."
              : `“${cue.text}”`}
        </p>
        {started && cue.sources.length > 0 && (
          <div
            className="voice-source-links"
            onClick={() => audio.current?.pause()}
          >
            {cue.sources.map((source) => (
              <SourceLink key={source} kind={source}>
                {sourceNames[source]}
              </SourceLink>
            ))}
          </div>
        )}
      </div>
      <div className="voice-native-controls">
        <span aria-hidden="true">
          <Video size={19} />
        </span>
        <button
          type="button"
          onClick={toggle}
          className={`mic-play ${playing ? "is-unmuted" : ""}`}
          aria-label={
            playing
              ? "Mute and pause the group conversation"
              : "Unmute and play the group conversation"
          }
          aria-pressed={playing}
          title={playing ? "Mute / pause" : "Unmute / play"}
        >
          {status === "loading" ? (
            <LoaderCircle size={19} className="loading-spinner" />
          ) : playing ? (
            <Mic size={19} />
          ) : (
            <MicOff size={19} />
          )}
        </button>
        <button
          type="button"
          className="hang-up"
          aria-label="End and reset the group conversation"
          onClick={stop}
        >
          <PhoneOff size={19} />
        </button>
      </div>
      <div className="voice-playback-note">
        {status === "ended"
          ? "Call finished · unmute to replay"
          : playing
            ? "Playing the group conversation"
            : status === "paused"
              ? "Paused · unmute to continue"
              : "Unmute to play · about 1 min 40 sec"}
      </div>
    </div>
  );
}
export function Phone({ children }: { children: React.ReactNode }) {
  return (
    <div className="iphone-bezel">
      <div className="hardware-btn hardware-one" />
      <div className="hardware-btn hardware-two" />
      <div className="hardware-btn hardware-three" />
      <div className="phone-screen">
        <div className="phone-status">
          <span>9:41</span>
          <div className="dynamic-island" />
          <div>
            <Signal size={12} />
            <BatteryFull size={17} />
          </div>
        </div>
        {children}
        <div className="screen-glare" />
        <div className="home-indicator" />
      </div>
    </div>
  );
}
