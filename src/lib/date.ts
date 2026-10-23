/** 全部日期以 YYYY-MM-DD 字符串存储，内部按 UTC 计算，避免时区偏移。 */

const DAY = 86400000;

export function parseDate(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

export function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(s: string, n: number): string {
  return toISO(new Date(parseDate(s).getTime() + n * DAY));
}

/** b - a，单位天 */
export function diffDays(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / DAY);
}

export function today(): string {
  const now = new Date();
  return toISO(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

/** 含首尾的天数 */
export function spanDays(a: string, b: string): number {
  return diffDays(a, b) + 1;
}

export function minDate(a: string, b: string): string {
  return a <= b ? a : b;
}

export function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}

/** 以下 *Safe 版本均允许 null（表示「无日期」），参与运算时忽略 null 一方 */

export function addDaysSafe(s: string | null, n: number): string | null {
  if (!s) return null;
  return addDays(s, n);
}

export function diffDaysSafe(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  return diffDays(a, b);
}

export function minDateSafe(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

export function maxDateSafe(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

export function startOfWeek(s: string): string {
  const d = parseDate(s);
  const dow = (d.getUTCDay() + 6) % 7; // 周一为 0
  return addDays(s, -dow);
}

export function startOfMonth(s: string): string {
  return `${s.slice(0, 7)}-01`;
}

export function addMonths(s: string, n: number): string {
  const d = parseDate(s);
  const nd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const lastDay = new Date(Date.UTC(nd.getUTCFullYear(), nd.getUTCMonth() + 1, 0)).getUTCDate();
  nd.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return toISO(nd);
}

export function formatCN(s: string | null | undefined): string {
  if (!s) return '无';
  const [, m, d] = s.split('-');
  return `${Number(m)}月${Number(d)}日`;
}

export function weekdayCN(s: string): string {
  return ['一', '二', '三', '四', '五', '六', '日'][(parseDate(s).getUTCDay() + 6) % 7];
}

export function isWeekend(s: string): boolean {
  const dow = parseDate(s).getUTCDay();
  return dow === 0 || dow === 6;
}
