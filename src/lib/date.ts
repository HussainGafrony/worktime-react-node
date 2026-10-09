export function localToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isSunday(date: string) {
  return new Date(`${date}T12:00:00`).getDay() === 0;
}

export function formatHours(value: number) {
  return `${Number(value || 0).toFixed(2).replace(/\.00$/, '')}h`;
}

export function formatSubmittedAt(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

export function makeTimeOptions() {
  const rows: string[] = [];
  for (let hour = 0; hour <= 23; hour += 1) {
    rows.push(`${String(hour).padStart(2, '0')}:00`);
    rows.push(`${String(hour).padStart(2, '0')}:30`);
  }
  return rows;
}
