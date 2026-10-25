import generated from "./voice-scenario.json";
import type { Person } from "./story";
export type VoiceSource = "catalog" | "syllabus" | "reviews";
export type VoiceCue = {
  person: Person;
  text: string;
  sources: VoiceSource[];
  start: number;
  end: number;
};
export const voiceScenario = generated;
const readable = (text: string) =>
  text
    .replaceAll("Spring twenty twenty-seven", "Spring 2027")
    .replaceAll("C S E five seventy-two", "CSE 572")
    .replaceAll("five seventy-three", "CSE 573")
    .replaceAll("C S E five ten", "CSE 510")
    .replaceAll("C S E five sixty-four", "CSE 564");
export const voiceCues: VoiceCue[] = generated.cues.map((cue) => ({
  ...cue,
  person: cue.person as Person,
  sources: cue.sources as VoiceSource[],
  text: readable(cue.text),
}));
