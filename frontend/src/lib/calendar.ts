// Календарь ротации и окна событий — зеркало backend/api/lib/calendar.php и
// windows.php, чтобы экран показывал то же, что сервер шлёт в напоминаниях.

import { OVERRIDES, RESIDENTS, SETTINGS, WEEKS, UNITS, type Block, weekByNum, unitById, curatorById, fmtD, shortFio } from "../data";

export type Status = "past" | "current" | "future";

const toIso = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toIso(d);
};

/** День ротации: исключения по дням → выходные → флаг недели. */
export function isRotationDay(iso: string): boolean {
  for (const o of OVERRIDES) {
    if (o.dateFrom <= iso && iso <= o.dateTo) return o.kind === "on";
  }
  const wd = new Date(iso + "T00:00:00").getDay();
  if (wd === 0 || wd === 6) return false;
  const w = WEEKS.find((x) => x.start <= iso && iso <= x.end);
  return w ? w.isRotation : false;
}

export function blockStart(bl: Pick<Block, "from" | "to">): string {
  const raw = weekByNum(bl.from).start, end = weekByNum(bl.to).end;
  for (let d = raw; d <= end; d = addDays(d, 1)) if (isRotationDay(d)) return d;
  return raw;
}

export function blockEnd(bl: Pick<Block, "from" | "to">): string {
  const raw = weekByNum(bl.to).end, start = weekByNum(bl.from).start;
  for (let d = raw; d >= start; d = addDays(d, -1)) if (isRotationDay(d)) return d;
  return raw;
}

export function blockStatus(bl: Block, date: string): Status {
  if (blockEnd(bl) < date) return "past";
  if (blockStart(bl) > date) return "future";
  return "current";
}

export function currentWeekNum(date: string): number | null {
  const w = WEEKS.find((w) => w.start <= date && date <= w.end);
  return w ? w.num : null;
}

export function subRotationDays(iso: string, n: number): string {
  let d = iso, left = n, guard = 0;
  while (left > 0 && guard++ < 400) {
    d = addDays(d, -1);
    if (isRotationDay(d)) left--;
  }
  return d;
}

export function diffDays(a: string, b: string): number {
  return Math.round((+new Date(b + "T00:00:00") - +new Date(a + "T00:00:00")) / 86400000);
}

/** блок в предпоследнем/последнем дне курации */
export function isFinishing(bl: Block, date: string, finishDays = 2): boolean {
  return blockStatus(bl, date) === "current" && date >= subRotationDays(blockEnd(bl), finishDays - 1);
}

/** до старта блока осталось 1–3 календарных дня */
export function isComingSoon(bl: Block, date: string, incomingDays = 3): boolean {
  const dd = diffDays(date, blockStart(bl));
  return dd >= 1 && dd <= incomingDays;
}

export function nextBlockFor(blocks: Block[], residentId: string, afterWeek: number): Block | null {
  return blocks
    .filter((b) => b.residentId === residentId && b.from > afterWeek)
    .sort((a, z) => a.from - z.from)[0] ?? null;
}

export function nextDestText(blocks: Block[], bl: Block): string {
  const nb = nextBlockFor(blocks, bl.residentId, bl.to);
  if (!nb) return "ротации по графику завершены";
  const u = unitById(nb.unitId);
  const cur = nb.curatorId
    ? `куратор: ${shortFio(curatorById(nb.curatorId)!.fio)}`
    : "⚠️ куратор не назначен";
  return `${u.name}, с ${fmtD(blockStart(nb))} · ${cur}`;
}

/** Загрузка подразделений: unitId → weekNum → число ординаторов (только активные). */
export function unitLoad(blocks: Block[]): Map<string, Map<number, number>> {
  const active = new Set(RESIDENTS.filter((r) => r.active).map((r) => r.id));
  const m = new Map<string, Map<number, number>>();
  for (const b of blocks) {
    if (!active.has(b.residentId)) continue;
    let row = m.get(b.unitId);
    if (!row) { row = new Map(); m.set(b.unitId, row); }
    for (let w = b.from; w <= b.to; w++) row.set(w, (row.get(w) ?? 0) + 1);
  }
  return m;
}

export interface Overload { unitId: string; from: number; to: number; count: number; }

/** Отрезки недель, где загрузка выше порога. */
export function overloads(blocks: Block[], threshold = SETTINGS.capacityThreshold): Overload[] {
  const out: Overload[] = [];
  const load = unitLoad(blocks);
  for (const u of UNITS) {
    const row = load.get(u.id);
    if (!row) continue;
    let run: Overload | null = null;
    for (const w of WEEKS) {
      const c = row.get(w.num) ?? 0;
      if (c > threshold) {
        if (run && run.to === w.num - 1 && run.count === c) run.to = w.num;
        else { if (run) out.push(run); run = { unitId: u.id, from: w.num, to: w.num, count: c }; }
      }
    }
    if (run) out.push(run);
  }
  return out;
}
