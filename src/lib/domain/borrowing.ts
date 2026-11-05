import type { Book, IsoDate } from './types';

/** Borrowed books (from a library or a friend), with a due date and reminders to give them back. */

export const DEFAULT_LOAN_DAYS = 28;
/** "Due soon" from this many days before the due date. */
export const SOON_DAYS = 3;

export function addDays(day: IsoDate, n: number): IsoDate {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
}

export type DueState = 'overdue' | 'today' | 'soon' | 'ok' | 'open';

export interface Due {
  state: DueState;
  /** Days until due (negative = overdue). */
  days?: number;
}

export function isBorrowed(b: Pick<Book, 'ownership'>): boolean {
  return b.ownership === 'borrowed';
}

export function dueOf(b: Pick<Book, 'ownership' | 'borrowed'>, today: IsoDate): Due {
  if (!isBorrowed(b) || !b.borrowed?.dueOn) return { state: 'open' };
  const days = daysBetween(today, b.borrowed.dueOn);
  return { days, state: days < 0 ? 'overdue' : days === 0 ? 'today' : days <= SOON_DAYS ? 'soon' : 'ok' };
}

/** "due in 5 days", "due tomorrow", "2 days overdue"… */
export function dueText(d: Due): string {
  if (d.days === undefined) return 'no due date';
  if (d.days < 0) return d.days === -1 ? '1 day overdue' : `${-d.days} days overdue`;
  if (d.days === 0) return 'due today';
  if (d.days === 1) return 'due tomorrow';
  return `due in ${d.days} days`;
}

/** Borrowed books that need attention (overdue, due today or soon), most urgent first. */
export function dueSoon<T extends Pick<Book, 'ownership' | 'borrowed'>>(books: T[], today: IsoDate): T[] {
  return books
    .filter((b) => ['overdue', 'today', 'soon'].includes(dueOf(b, today).state))
    .sort((a, b) => (a.borrowed!.dueOn ?? '').localeCompare(b.borrowed!.dueOn ?? ''));
}

/** Where you borrow from (suggestions), most used first. */
export function lenders(books: Pick<Book, 'borrowed'>[]): string[] {
  const n = new Map<string, number>();
  for (const b of books) if (b.borrowed?.from) n.set(b.borrowed.from, (n.get(b.borrowed.from) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
}

const ics = (s: string) => s.replace(/[\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
const icsDate = (d: IsoDate) => d.replace(/-/g, '');

/**
 * A calendar event on the due date (all day) with an alarm the evening before at 18:00 (local time
 * of the phone's calendar), so the phone reminds you even when Booked is closed.
 */
export function returnReminderIcs(b: Pick<Book, 'id' | 'title' | 'authors' | 'borrowed'>, now = new Date()): string {
  const due = b.borrowed?.dueOn;
  if (!due) throw new Error('This book has no due date');
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const what = `Return „${b.title}“${b.borrowed?.from ? ` to ${b.borrowed.from}` : ''}`;
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Booked//Return reminder//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:booked-return-${b.id}-${icsDate(due)}@booked`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${icsDate(due)}`,
    `DTEND;VALUE=DATE:${icsDate(addDays(due, 1))}`,
    `SUMMARY:${ics(what)}`,
    `DESCRIPTION:${ics([b.title, b.authors.join(', '), b.borrowed?.from ? `Borrowed from ${b.borrowed.from}` : ''].filter(Boolean).join('\n'))}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${ics(what)}`, 'TRIGGER:-PT6H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', ''
  ].join('\r\n');
}
