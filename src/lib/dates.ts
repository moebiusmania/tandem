const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** Whole days from `today` to `iso` (negative = past). */
export function daysBetween(today: Date, iso: string): number {
  const a = parseIso(isoDate(today));
  const b = parseIso(iso);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Short, relative label for a due date: Today, Tomorrow, Fri, Yesterday, 3 Nov. */
export function dueLabel(today: Date, iso: string): { label: string; overdue: boolean } {
  const diff = daysBetween(today, iso);
  const d = parseIso(iso);
  if (diff === 0) return { label: "Today", overdue: false };
  if (diff === 1) return { label: "Tomorrow", overdue: false };
  if (diff === -1) return { label: "Yesterday", overdue: true };
  if (diff > 1 && diff < 7) return { label: WEEKDAYS[d.getDay()]!.slice(0, 3), overdue: false };
  return { label: `${d.getDate()} ${MONTHS[d.getMonth()]!.slice(0, 3)}`, overdue: diff < 0 };
}
