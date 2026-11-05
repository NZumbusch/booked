import { dueOf, dueSoon, dueText, returnReminderIcs } from '../domain/borrowing';
import { todayIso } from '../domain/book';
import type { Book } from '../domain/types';
import type { Library } from '../services/library';

/** Reminders to give borrowed books back: a calendar event, and a notification when Booked opens. */

/** Download a calendar event (with alarm) for the due date; the phone's calendar app takes it from there. */
export function addReturnToCalendar(b: Book) {
  const blob = new Blob([returnReminderIcs(b)], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `return-${b.title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40)}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export const notificationsSupported = () => typeof Notification !== 'undefined' && 'serviceWorker' in navigator;
export const notificationsOn = () => notificationsSupported() && Notification.permission === 'granted';

/** Ask once (from a tap). Returns whether notifications are now allowed. */
export async function enableDueNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  return (await Notification.requestPermission()) === 'granted';
}

/**
 * When Booked opens (or comes back to the front): if borrowed books are overdue or due within a few
 * days, show one system notification, at most once a day.
 */
export async function checkDueNotice(lib: Library): Promise<void> {
  if (!notificationsOn()) return;
  const today = todayIso();
  if (lib.state.settings.lastDueNotice === today) return;
  const due = dueSoon(lib.state.books, today);
  if (!due.length) return;
  const lines = due.slice(0, 4).map((b) => `${b.title} (${dueText(dueOf(b, today))})`);
  const body = lines.join('\n') + (due.length > 4 ? `\n…and ${due.length - 4} more` : '');
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(due.length === 1 ? 'A book to give back' : `${due.length} books to give back`, {
      body, tag: 'booked-due', data: { url: './#/lending' }, icon: 'icon-192.png'
    });
    await lib.updateSettings({ lastDueNotice: today });
  } catch {
    // notifications blocked or no service worker (dev): the banner on Home still shows it
  }
}
