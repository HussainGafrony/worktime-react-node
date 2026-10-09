const APP_TIMEZONE = 'Europe/Athens';

export function localToday() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function isSunday(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay() === 0;
}

export function formatHours(value: number) {
  return `${Number(value || 0).toFixed(2).replace(/\.00$/, '')}h`;
}

export function formatSubmittedAt(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: APP_TIMEZONE
  });
}

export function makeTimeOptions() {
  const rows: string[] = [];
  for (let hour = 0; hour <= 23; hour += 1) {
    rows.push(`${String(hour).padStart(2, '0')}:00`);
    rows.push(`${String(hour).padStart(2, '0')}:30`);
  }
  return rows;
}
