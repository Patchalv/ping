// When something was posted, short enough for a Thread row: the time today, "Yesterday"
// and the time, the day and month this year, and the full date before that. In the
// browser's time zone, 24-hour, day before month.

const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const DAY_MONTH = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const FULL_DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export function formatPostedAt(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (sameDay(at, now)) return TIME.format(at);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(at, yesterday)) return `Yesterday ${TIME.format(at)}`;
  if (at.getFullYear() === now.getFullYear()) return DAY_MONTH.format(at);
  return FULL_DATE.format(at);
}
