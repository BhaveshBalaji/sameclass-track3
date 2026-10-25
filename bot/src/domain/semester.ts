import { PlanningError } from './planning.js';

const seasons = { spring: '1', summer: '4', fall: '7', autumn: '7' } as const;
/** ASU codes remain a wire/storage detail; accept old codes for existing clients. */
export function semesterCode(value: string): string {
  const text = value.trim().toLowerCase();
  if (/^2\d{2}[147]$/.test(text)) return text;
  if (!/^(?:(?:spring|summer|fall|autumn)\s+20\d{2}|20\d{2}\s+(?:spring|summer|fall|autumn))$/.test(text)) {
    throw new PlanningError('Choose a semester such as Spring 2027 or Fall 2027.');
  }
  // Handle year-first input separately to keep the mapping unambiguous.
  const parts = text.split(/\s+/), season = /^20/.test(parts[0]!) ? parts[1]! : parts[0]!;
  const year = /^20/.test(parts[0]!) ? parts[0]! : parts[1]!;
  return `2${year.slice(2)}${seasons[season as keyof typeof seasons]}`;
}
export function semesterName(code: string): string {
  return `${({ '1': 'Spring', '4': 'Summer', '7': 'Fall' } as Record<string,string>)[code.slice(-1)] ?? 'Semester'} 20${code.slice(1,3)}`;
}
export function semesterChoices(value: string, now = new Date()): {name: string;value: string}[] {
  const year = Number(new Intl.DateTimeFormat('en-US',{year:'numeric',timeZone:'America/Phoenix'}).format(now));
  return Array.from({length: 4},(_,i) => year-1+i).flatMap(y => ['Spring','Summer','Fall'].map(s => `${s} ${y}`))
    .filter(name => name.toLowerCase().includes(value.trim().toLowerCase())).map(name => ({name,value:name}));
}
