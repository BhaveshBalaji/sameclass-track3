import { useLayoutEffect, useRef } from "react";
import {
  ArrowLeft,
  Hash,
  Plus,
  Smile,
  Mic,
  Headphones,
  Volume2,
  Video,
  PhoneOff,
  Signal,
  BatteryFull,
} from "lucide-react";
import { type ChatLine, type Person, voiceLines } from "@/data/story";
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
  beat,
  reading = false,
}: {
  beat: number;
  reading?: boolean;
}) {
  const current = voiceLines[Math.min(beat, voiceLines.length - 1)];
  return (
    <div className="discord-voice">
      <div className="discord-header">
        <ArrowLeft size={21} />
        <Volume2 size={21} />
        <span>
          The study room<small>Voice channel</small>
        </span>
      </div>
      <div className="voice-connected">
        <Signal size={12} /> Voice connected
      </div>
      <div className="voice-grid">
        {(["Maya", "Arjun", "Nina", "Leo", "Ray"] as Person[]).map((person) => (
          <div
            className={`voice-member ${current.person === person ? "is-speaking" : ""}`}
            key={person}
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
        className={`voice-wave ${reading ? "still" : ""}`}
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
      <div className="live-caption">
        <strong>{current.person}</strong>
        <p>“{current.text}”</p>
      </div>
      <div className="voice-native-controls" aria-hidden="true">
        <span>
          <Video size={19} />
        </span>
        <span>
          <Mic size={19} />
        </span>
        <span className="hang-up">
          <PhoneOff size={19} />
        </span>
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
