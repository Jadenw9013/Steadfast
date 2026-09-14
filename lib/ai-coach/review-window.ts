import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
dayjs.extend(utc);
dayjs.extend(timezone);

export function reviewWindow(now: Date, zone: string) {
  // Validate explicitly: invalid zones must never silently fall back to UTC.
  new Intl.DateTimeFormat("en", { timeZone: zone }).format(now);
  const local = dayjs(now).tz(zone).format("YYYY-MM-DD");
  const calendar = new Date(`${local}T00:00:00.000Z`);
  calendar.setUTCDate(calendar.getUTCDate() - (calendar.getUTCDay() + 6) % 7);
  const key = calendar.toISOString().slice(0, 10);
  const shift = (days: number) => {
    const d = new Date(calendar);
    d.setUTCDate(d.getUTCDate() + days);
    return dayjs.tz(`${d.toISOString().slice(0, 10)} 00:00`, zone).toDate();
  };
  return { key, activationStartsAt: shift(0), activationEndsAt: shift(7), lookbackStart: shift(-7), lookbackEnd: shift(0) };
}
