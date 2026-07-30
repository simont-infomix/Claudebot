const relative = new Intl.RelativeTimeFormat('hu', { numeric: 'auto' });
const absolute = new Intl.DateTimeFormat('hu-HU', { dateStyle: 'medium', timeStyle: 'short' });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600_000],
  ['month', 30 * 24 * 3600_000],
  ['day', 24 * 3600_000],
  ['hour', 3600_000],
  ['minute', 60_000],
];

export function formatRelative(timestamp: number): string {
  const diff = timestamp - Date.now();
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return relative.format(Math.round(diff / ms), unit);
  }
  return 'most';
}

export function formatAbsolute(timestamp: number): string {
  return absolute.format(new Date(timestamp));
}
