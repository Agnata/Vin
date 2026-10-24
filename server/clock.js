// Calendar helpers for Swedish time, independent of the server's time zone.
const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", hourCycle: "h23", weekday: "short",
});
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// { date: "YYYY-MM-DD", hour: 0–23, weekday: 0 (Sunday)–6 } in Europe/Stockholm.
export function stockholm(date = new Date()) {
  const p = Object.fromEntries(fmt.formatToParts(date).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekday: WEEKDAYS[p.weekday] };
}
