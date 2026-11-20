// Day boundaries and weekend checks happen in the team's timezone.
export const SEND_TZ = process.env.SEND_TIMEZONE || "Asia/Kolkata";

function parts(d: Date, tz = SEND_TZ) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return o;
}

/** Offset (ms) between UTC and the zone at instant d. */
function offsetMs(d: Date, tz = SEND_TZ): number {
  const p = parts(d, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
  return asUtc - Math.floor(d.getTime() / 60000) * 60000;
}

export function isWeekend(d: Date, tz = SEND_TZ): boolean {
  const w = parts(d, tz).weekday;
  return w === "Sat" || w === "Sun";
}

/** Start of the local day containing d, as a UTC Date. */
export function startOfLocalDay(d: Date, tz = SEND_TZ): Date {
  const p = parts(d, tz);
  const utcGuess = Date.UTC(+p.year, +p.month - 1, +p.day, 0, 0);
  return new Date(utcGuess - offsetMs(d, tz));
}

/** Next local morning at hh:mm (tomorrow or later), optionally skipping weekends. */
export function nextMorning(d: Date, skipWeekends: boolean, hh = 9, mm = 30, tz = SEND_TZ): Date {
  let day = startOfLocalDay(d, tz);
  for (let i = 0; i < 8; i++) {
    day = new Date(day.getTime() + 86_400_000);
    const candidate = new Date(day.getTime() + (hh * 60 + mm) * 60_000);
    if (!skipWeekends || !isWeekend(candidate, tz)) return candidate;
  }
  return day;
}
