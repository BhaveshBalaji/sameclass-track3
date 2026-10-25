import { z } from 'zod';

export class PlanningError extends Error { constructor(message: string) { super(message); this.name = 'PlanningError'; } }
export const fieldSchema = z.enum(['approved_courses', 'credits', 'course_count', 'campus', 'unavailability',
  'preferred_times', 'topics', 'assessment', 'flexibility', 'requirement']);
export const factSchema = z.object({
  field: fieldSchema, strength: z.enum(['hard', 'soft', 'unrestricted']), values: z.array(z.string().min(1).max(250)).min(1).max(12),
  sources: z.array(z.object({ messageId: z.string(), quote: z.string().min(1).max(500) })).min(1).max(12),
});
export type Fact = z.infer<typeof factSchema>;
export const patchSchema = z.object({ facts: z.array(factSchema).max(10) });
export type Patch = z.infer<typeof patchSchema>;
export type Field = z.infer<typeof fieldSchema>;
export interface Profile { version: number; facts: Partial<Record<Field, Fact>> }
export interface Participant { userId: string; name: string; active: boolean; profile: Profile; silenceAsked: boolean; cursor: number }
export interface PlanningMessage { id: string; authorId: string; content: string; ordinal: number; ignored?: boolean }
export interface Clarification { id: string; userId: string; field: Field | 'participation'; question: string;
  state: 'pending' | 'answered'; responseId: string; messageIds: string[] }
export interface PlanningSession {
  id: string; guildId: string; channelId: string; creatorId: string; term: string; version: number;
  participants: Record<string, Participant>; messages: PlanningMessage[]; nextOrdinal: number; truncated: boolean;
  clarifications: Clarification[]; currentRequest?: string;
  resetConfirmation?: { actorId: string; token: string; expiresAt: number };
}
export interface Actor { userId: string; name: string; moderator?: boolean }
export interface Room { guildId: string; channelId: string }
export interface Incoming extends Room, Actor {
  id: string; content: string; botMention: boolean; replyTo?: string; bot?: boolean; webhook?: boolean;
}
export interface Outgoing {
  id: string; text: string; mentions: string[]; clarificationIds: string[];
  requestId?: string; replyTo?: string;
  buttons?: { label: string; action: 'join' | 'leave' | 'reset'; sessionId: string; token?: string; actorId?: string }[];
}
export interface ExtractionInput { userId: string; profile: Profile; messages: PlanningMessage[] }
export interface LanguageService {
  classify(content: string): Promise<'group_planning' | 'course_question' | 'profile_update'>;
  extract(input: ExtractionInput): Promise<Patch>;
}
export function clean(value: string): string {
  return value.replace(/@/g, '@\u200b').replace(/[<>`*_\\]/g, '\\$&');
}
export function validatePatch(patch: Patch, input: ExtractionInput): void {
  const seen = new Set<string>();
  for (const fact of patchSchema.parse(patch).facts) {
    if (seen.has(fact.field)) throw new Error('Duplicate preference field.');
    seen.add(fact.field);
    for (const source of fact.sources) {
      const message = input.messages.find(m => m.id === source.messageId && m.authorId === input.userId && !m.ignored);
      if (!message || !message.content.includes(source.quote)) throw new Error('Preference source does not belong to this author.');
    }
  }
}
export function missingQuestion(participant: Participant): { field: Field | 'participation'; question: string } | undefined {
  const facts = participant.profile.facts;
  if (!Object.keys(facts).length) return participant.silenceAsked ? undefined : {
    field: 'participation', question: 'Would you like to share your course requirements and availability for this planning session?' };
  if (facts.requirement && !facts.approved_courses) return { field: 'approved_courses', question: 'Which courses are on your approved list for that requirement?' };
  if (!facts.approved_courses && !facts.requirement) return { field: 'requirement', question: 'Which courses or elective requirement should I consider for you?' };
  if (!facts.credits) return { field: 'credits', question: 'How many credits do you need for this choice?' };
  if (!facts.campus) return { field: 'campus', question: 'Which campus or online program should I use for your search?' };
  if (!facts.unavailability && !facts.flexibility) return { field: 'unavailability', question: 'Which times are unavailable, or are your weekday times explicitly unrestricted?' };
  return undefined;
}
