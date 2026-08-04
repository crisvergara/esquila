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
