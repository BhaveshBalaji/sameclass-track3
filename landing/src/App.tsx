import { useEffect, useRef, useState, type MouseEvent } from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  Pause,
  Play,
  X,
  Volume2,
} from "lucide-react";
import { CinematicHero } from "@/components/ui/cinematic-landing-hero";
import { RayIcon } from "@/components/ui/discord";
import { sourceContent } from "@/data/story";

export default function App() {
  const [reading, setReading] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [source, setSource] = useState<keyof typeof sourceContent>("catalog");
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState(() => {
    try {
      return localStorage.getItem("ray-discord-link") || "";
    } catch {
      return "";
    }
  });
  const [draft, setDraft] = useState(link);
  const [error, setError] = useState("");
  const sourceDialog = useRef<HTMLDialogElement>(null);
  const demoDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReading(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("reading-mode", reading);
    return () => document.documentElement.classList.remove("reading-mode");
  }, [reading]);
  const inspectSource = (event: MouseEvent) => {
    const kind = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-source]",
    )?.dataset.source;
    if (kind && kind in sourceContent) {
      setSource(kind as keyof typeof sourceContent);
      sourceDialog.current?.showModal();
    }
  };
  const openDemo = () => {
    if (link) {
      window.open(link, "_blank", "noopener,noreferrer");
    } else demoDialog.current?.showModal();
  };
  const save = () => {
    const value = draft.trim();
    if (
      !/^https:\/\/(?:(?:www\.)?discord\.com\/channels\/\d+\/\d+|discord\.gg\/[A-Za-z0-9-]+)\/?$/.test(
        value,
      )
    ) {
      setError("Use a Discord channel link or discord.gg invite.");
      return;
    }
    setLink(value);
    setError("");
    try {
      localStorage.setItem("ray-discord-link", value);
    } catch {
      /* Link remains usable in this session. */
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText("/plan recommend");
      setCopied(true);
    } catch {
      setError("Command: /plan recommend");
    }
  };
  const toggleReading = () => {
    window.scrollTo({ top: 0, behavior: "instant" });
    setReading((value) => !value);
  };
  const selected = sourceContent[source];
  return (
    <div className="app" onClick={inspectSource}>
      <a href="#main" className="skip-link">
        Skip to story
      </a>
      <header className="site-header">
        <a href="#" className="brand" aria-label="Ray home">
          <RayIcon />
          <span>RAY</span>
        </a>
        <span className="header-caption">A SEMESTER, TOGETHER.</span>
        <div className="header-actions">
          <button
            className="motion-control"
            onClick={toggleReading}
            aria-pressed={reading}
            aria-label={
              reading ? "Enable cinematic scrolling" : "Read without animation"
            }
          >
            {reading ? <Play size={14} /> : <Pause size={14} />}
            <span>{reading ? "Cinematic mode" : "Read mode"}</span>
          </button>
          <button className="header-cta" onClick={openDemo}>
            Meet Ray <ArrowUpRight size={15} />
          </button>
        </div>
      </header>
      <main id="main">
        <CinematicHero reading={reading} onDemo={openDemo} />
      </main>
      <footer className="site-footer">
        <span>RAY / BUILT FOR THE CONVERSATION.</span>
        <span>Course research. Group planning. Discord voice.</span>
        <button onClick={() => demoDialog.current?.showModal()}>
          Demo setup <ArrowUpRight size={11} />
        </button>
      </footer>
      <dialog
        ref={sourceDialog}
        className="source-dialog"
        aria-labelledby="source-title"
      >
        <button
          className="close-dialog"
          aria-label="Close source"
          onClick={() => sourceDialog.current?.close()}
        >
          <X size={22} />
        </button>
        <p className="eyebrow">{selected.label}</p>
        <h2 id="source-title">{selected.title}</h2>
        <p>{selected.body}</p>
        <div className="source-excerpt">
          {selected.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        {selected.url && (
          <a
            href={selected.url}
            target="_blank"
            rel="noreferrer"
            className="text-action"
          >
            {selected.link}
            <ArrowUpRight size={16} />
          </a>
        )}
        <p className="source-note">
          The presentation shows the interaction. The live bot retrieves the
          actual source for the requested course, instructor and semester.
        </p>
      </dialog>
      <dialog
        ref={demoDialog}
        className="demo-dialog"
        aria-labelledby="demo-title"
      >
        <button
          className="close-dialog"
          aria-label="Close demo setup"
          onClick={() => demoDialog.current?.close()}
        >
          <X size={22} />
        </button>
        <RayIcon />
        <p className="eyebrow">FROM THE STORY TO YOUR SERVER.</p>
        <h2 id="demo-title">Let’s talk to Ray.</h2>
        <p>
          Open your Discord server with Ray running, and continue the
          conversation live.
        </p>
        <ol>
          <li>
            <b>01</b>
            <span>
              Start planning, join the session, and share each student’s
              preferences.
            </span>
          </li>
          <li>
            <b>02</b>
            <span>
              Use <code>/ask</code> for courses, professor reviews, or syllabus
              questions.
            </span>
          </li>
          <li>
            <b>03</b>
            <span>
              Run <code>/plan recommend</code>, then discuss the individual and
              shared options.
            </span>
          </li>
          <li>
            <Volume2 size={17} />
            <span>
              Join the voice channel with your voice-enabled bot and say “Ray.”
            </span>
          </li>
        </ol>
        <button className="copy-command" onClick={copy}>
          {copied ? <Check size={15} /> : <Copy size={15} />}{" "}
          {copied ? "Copied /plan recommend" : "Copy /plan recommend"}
        </button>
        <div className="demo-configuration">
          <label htmlFor="discord-url">Your Discord demo channel</label>
          <div>
            <input
              id="discord-url"
              type="url"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="https://discord.com/channels/…/…"
            />
            <button onClick={save}>
              Save <ArrowUpRight size={16} />
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {link && (
            <a
              className="text-action"
              href={link}
              target="_blank"
              rel="noreferrer"
            >
              Open the live demo <ArrowUpRight size={15} />
            </a>
          )}
          <small>Saved only in this browser. No credentials needed.</small>
        </div>
      </dialog>
    </div>
  );
}
