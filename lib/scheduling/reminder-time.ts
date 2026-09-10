export function isReminderHour(configuredTime: string, timezone: string, now: Date): boolean {
  try {
    const hour = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(now);
    return configuredTime.split(":")[0].padStart(2, "0") === hour;
  } catch { return false; }
}
