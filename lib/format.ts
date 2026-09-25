export const money = (n: number) => `₪${n.toFixed(2)}`;
export const km = (n: number) =>
  new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(n);
export const name = (key: string) =>
  key.startsWith("guest:")
    ? key.slice(6) + " (Guest)"
    : key.charAt(0).toUpperCase() + key.slice(1);
export const date = (s: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(s))
    .replace(",", " at");
export const monthKey = (s: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date(s))
    .split("/")
    .reverse()
    .join("-");
export function calendarKey(s: string) {
  const p = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(s));
  return `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}`;
}
export const monthLabel = (key: string, long = false) =>
  new Intl.DateTimeFormat("en", {
    month: long ? "long" : "short",
    ...(long ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  }).format(new Date(`${key}-15T12:00:00Z`));
