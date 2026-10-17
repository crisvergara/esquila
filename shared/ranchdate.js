// All calendar-day semantics in Esquila use the ranch's timezone.
export const RANCH_TIMEZONE = "America/Santiago";

// en-CA renders as YYYY-MM-DD.
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: RANCH_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Ranch-local calendar day (YYYY-MM-DD) for an ISO timestamp / Date / epoch ms.
export function ranchDay(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return dayFormatter.format(d);
}

export const validRanchDay = value => typeof value === 'string' && !value.startsWith('0000-') && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

// Find actual local-day boundaries, including Chile's skipped/repeated midnight
// during DST. Fixed UTC offsets or adding 24 hours would select the wrong rows.
export function ranchDayBounds(day) {
  if (!validRanchDay(day)) throw new Error('Fecha inválida.');
  const utc = Date.parse(`${day}T00:00:00.000Z`), target = Number(day.replaceAll('-', ''));
  function boundary(after) {
    let lo = utc - 36 * 3600000, hi = utc + 48 * 3600000;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const current = Number(ranchDay(mid).replaceAll('-', ''));
      if (current < target || (after && current === target)) lo = mid + 1;
      else hi = mid;
    }
    return new Date(lo).toISOString();
  }
  return { start: boundary(false), end: boundary(true) };
}
