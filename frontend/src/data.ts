// Справочники графика. Данные приходят с сервера (GET /api/schedule) для
// выбранного учебного года и заполняются через setScheduleData; импорты и
// помощники — те же, что были в прототипе.

export interface Week { num: number; start: string; end: string; label: string; isRotation: boolean; note?: string | null; }
export interface Override { id: number; dateFrom: string; dateTo: string; kind: "off" | "on"; note?: string | null; }
export interface Year { id: string; label: string; dateStart: string; dateEnd: string; isCurrent: boolean; note?: string | null; }
export interface Organization { id: string; short: string; name: string; }
export interface Curator { id: string; fio: string; note?: string | null; }
export interface Unit {
  id: string; short: string; name: string;
  rule: "auto" | "manual"; color: string; candidates: string[];
}
export interface Resident {
  id: string; fio: string; year: number; orgId: string;
  mode: "rotation" | "fixed"; priority: string | null; active: boolean;
}
export interface Block {
  id: string; residentId: string; unitId: string;
  from: number; to: number; curatorId: string | null;
  comment?: string | null;
}
export interface User { id: number; login: string; name: string; role: "admin" | "dispatcher"; orgId: string | null; }

export const WEEKS: Week[] = [];
export const OVERRIDES: Override[] = [];
export const YEARS: Year[] = [];
export const ORGS: Organization[] = [];
export const UNITS: Unit[] = [];
export const CURATORS: Curator[] = [];
export const RESIDENTS: Resident[] = [];
export const SETTINGS = { capacityThreshold: 3, year: "" };

export function setScheduleData(d: {
  year: string; years: Year[]; weeks: Week[]; overrides: Override[]; organizations: Organization[];
  units: Unit[]; curators: Curator[]; residents: Resident[]; capacityThreshold: number;
}): void {
  WEEKS.splice(0, WEEKS.length, ...d.weeks);
  OVERRIDES.splice(0, OVERRIDES.length, ...d.overrides);
  YEARS.splice(0, YEARS.length, ...d.years);
  ORGS.splice(0, ORGS.length, ...d.organizations);
  UNITS.splice(0, UNITS.length, ...d.units);
  CURATORS.splice(0, CURATORS.length, ...d.curators);
  RESIDENTS.splice(0, RESIDENTS.length, ...d.residents);
  SETTINGS.capacityThreshold = d.capacityThreshold;
  SETTINGS.year = d.year;
}

export const weekByNum = (num: number) => WEEKS.find((w) => w.num === num)!;
export const unitById = (id: string) => UNITS.find((u) => u.id === id)!;
export const curatorById = (id: string) => CURATORS.find((c) => c.id === id);
export const residentById = (id: string) => RESIDENTS.find((r) => r.id === id)!;
export const orgById = (id: string) => ORGS.find((o) => o.id === id);
export const yearLabel = () => YEARS.find((y) => y.id === SETTINGS.year)?.label ?? SETTINGS.year;

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

export const yearWord = (y: number) => `${y} год`;
