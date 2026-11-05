import { describe, expect, it } from 'vitest';
import { addDays, dueOf, dueSoon, dueText, lenders, returnReminderIcs } from './borrowing';

const b = (dueOn?: string, from = 'Stadtbibliothek') => ({ id: 'x', title: 'Der Zauberberg', authors: ['Thomas Mann'], ownership: 'borrowed' as const, borrowed: { from, on: '2026-10-01', dueOn } });

describe('borrowing', () => {
  it('adds days across month ends', () => {
    expect(addDays('2026-11-05', 28)).toBe('2026-12-03');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });
  it('knows when a book is due', () => {
    expect(dueOf(b('2026-11-20'), '2026-11-05')).toEqual({ state: 'ok', days: 15 });
    expect(dueOf(b('2026-11-07'), '2026-11-05')).toEqual({ state: 'soon', days: 2 });
    expect(dueOf(b('2026-11-05'), '2026-11-05').state).toBe('today');
    expect(dueOf(b('2026-11-01'), '2026-11-05')).toEqual({ state: 'overdue', days: -4 });
    expect(dueOf(b(), '2026-11-05').state).toBe('open');
    expect(dueText({ state: 'soon', days: 1 })).toBe('due tomorrow');
    expect(dueText({ state: 'overdue', days: -4 })).toBe('4 days overdue');
  });
  it('lists the urgent ones first, and where you borrow from', () => {
    const list = [b('2026-11-20'), b('2026-11-06'), b('2026-11-01')];
    expect(dueSoon(list, '2026-11-05').map((x) => x.borrowed.dueOn)).toEqual(['2026-11-01', '2026-11-06']);
    expect(lenders([b(undefined, 'Anna'), b(), b()])).toEqual(['Stadtbibliothek', 'Anna']);
  });
  it('makes a calendar event with an alarm', () => {
    const ics = returnReminderIcs(b('2026-12-03'), new Date('2026-11-05T10:00:00Z'));
    expect(ics).toContain('DTSTART;VALUE=DATE:20261203');
    expect(ics).toContain('SUMMARY:Return „Der Zauberberg“ to Stadtbibliothek');
    expect(ics).toContain('BEGIN:VALARM');
  });
});
