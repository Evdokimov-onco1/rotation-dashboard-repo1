// Справочники графика. В отличие от прототипа данные не зашиты в код,
// а приходят с сервера (GET /api/schedule) и заполняются один раз при
// загрузке приложения через setScheduleData — импорты и помощники при этом
// те же, что были в прототипе.

export interface Week { num: number; start: string; end: string; label: string; }
export interface Curator { id: string; fio: string; note?: string | null; }
export interface Unit {
  id: string; short: string; name: string;
  rule: "auto" | "manual"; color: string; candidates: string[];
}
export interface Resident { id: string; fio: string; }
export interface Block {
  id: string; residentId: string; unitId: string;
  from: number; to: number; curatorId: string | null;
  comment?: string | null;
}

export const WEEKS: Week[] = [];
export const UNITS: Unit[] = [];
export const CURATORS: Curator[] = [];
export const RESIDENTS: Resident[] = [];

export function setScheduleData(d: {
  weeks: Week[]; units: Unit[]; curators: Curator[]; residents: Resident[];
}): void {
  WEEKS.splice(0, WEEKS.length, ...d.weeks);
  UNITS.splice(0, UNITS.length, ...d.units);
  CURATORS.splice(0, CURATORS.length, ...d.curators);
  RESIDENTS.splice(0, RESIDENTS.length, ...d.residents);
}

export const weekByNum = (num: number) => WEEKS.find((w) => w.num === num)!;
export const unitById = (id: string) => UNITS.find((u) => u.id === id)!;
export const curatorById = (id: string) => CURATORS.find((c) => c.id === id);
export const residentById = (id: string) => RESIDENTS.find((r) => r.id === id)!;

export const fmtD = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y.slice(2)}`;
};
export const blockRangeLabel = (bl: Pick<Block, "from" | "to">) =>
  `недели ${bl.from}–${bl.to} (${fmtD(weekByNum(bl.from).start)} – ${fmtD(weekByNum(bl.to).end)})`;

export const shortFio = (fio: string) => {
  const p = fio.split(" ");
  return p.length >= 3 ? `${p[0]} ${p[1][0]}.${p[2][0]}.` : fio;
};
