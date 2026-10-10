import { AppError } from './errors.js';

export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Europe/Athens';

export function appDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function isLateSubmission(workDate: string, submittedAt = new Date()) {
  return workDate < appDate(submittedAt);
}

export function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateWorkDate(date: string) {
  if (!isValidDate(date)) throw new AppError(400, 'INVALID_DATE', 'Please choose a valid date.');
  if (date > appDate()) throw new AppError(400, 'FUTURE_DATE', 'Future dates are not allowed.');
}

function dayOfWeek(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function parseTime(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  if (hours < 0 || hours > 23 || (minutes !== 0 && minutes !== 30)) return null;
  return hours * 60 + minutes;
}

export function hoursFor(date: string, start?: string | null, end?: string | null) {
  if (dayOfWeek(date) === 0) return { start: null, end: null, regular: 0, overtime: 0 };

  const startMinutes = start ? parseTime(start) : null;
  const endMinutes = end ? parseTime(end) : null;
  if (startMinutes === null || endMinutes === null) {
    throw new AppError(400, 'TIME_REQUIRED', 'Start and finish time are required in 30-minute steps.');
  }
  if (endMinutes <= startMinutes) {
    throw new AppError(400, 'INVALID_TIME_RANGE', 'Finish time must be later than start time.');
  }

  const regularStart = 8 * 60;
  const regularEnd = dayOfWeek(date) === 6 ? 15 * 60 : 16 * 60;
  const totalMinutes = endMinutes - startMinutes;
  const regularMinutes = Math.max(0, Math.min(endMinutes, regularEnd) - Math.max(startMinutes, regularStart));

  return {
    start: start ?? null,
    end: end ?? null,
    regular: Number((regularMinutes / 60).toFixed(2)),
    overtime: Number(((totalMinutes - regularMinutes) / 60).toFixed(2))
  };
}

export function isoWeekRange(value: string) {
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1 || week > 53) return null;

  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    from: monday.toISOString().slice(0, 10),
    to: sunday.toISOString().slice(0, 10)
  };
}

export function monthRange(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;

  const last = new Date(Date.UTC(year, month, 0));
  return {
    from: `${match[1]}-${match[2]}-01`,
    to: last.toISOString().slice(0, 10)
  };
}
