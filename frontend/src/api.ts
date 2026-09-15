// Клиент REST API (см. backend/api). Запросы same-origin,
// привилегированная сессия — httpOnly-cookie, из JS недоступна.

import type { Block, Curator, Organization, Override, Resident, Unit, User, Week, Year } from "./data";

export interface Schedule {
  today: string;
  year: string; years: Year[];
  weeks: Week[]; overrides: Override[]; organizations: Organization[];
  units: Unit[]; curators: Curator[]; residents: Resident[];
  blocks: Block[];
  windows: { finishWorkdays: number; incomingDays: number; recentDays: number };
  capacityThreshold: number;
  authorized: boolean;
  user: User | null;
}

export interface AuditEntry {
  id: number; ts: string; user: string | null; action: string; blockId: string | null;
  old: Record<string, unknown> | null; new: Record<string, unknown> | null;
}

export interface GenerateResult {
  yearId: string; fromWeek: number; residentIds: string[];
  blocks: Omit<Block, "id">[]; warnings: string[];
  overloads: { unitId: string; from: number; to: number; count: number }[];
  threshold: number; seed: number; excess: number;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api" + path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Сервер недоступен. Проверьте соединение и обновите страницу.");
  }
  let data: { error?: string } | null = null;
  try { data = await res.json(); } catch { /* пустой или не-JSON ответ */ }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Ошибка сервера (${res.status}).`);
  return data as T;
}

export const errText = (e: unknown) =>
  e instanceof Error ? e.message : "Непредвиденная ошибка.";

export type BlockInput = Omit<Block, "id">;
export interface ResidentInput { fio: string; orgId: string; year: number; mode: "rotation" | "fixed"; priority: string | null; active?: boolean; }
export interface UserInput { login?: string; name: string; role: "admin" | "dispatcher"; orgId: string | null; password?: string; active?: boolean; }

export const fetchSchedule = (year?: string) =>
  call<Schedule>("GET", "/schedule" + (year ? `?year=${encodeURIComponent(year)}` : ""));
export const authLogin = (login: string, password: string) => call<{ ok: true; user: User }>("POST", "/auth/login", { login, password });
export const authLogout = () => call<{ ok: true }>("POST", "/auth/logout");

export const createBlock = (b: BlockInput, yearId: string) => call<{ block: Block }>("POST", "/blocks", { ...b, yearId });
export const updateBlock = (id: string, b: BlockInput) => call<{ block: Block }>("PUT", `/blocks/${id}`, b);
export const deleteBlock = (id: string) => call<{ ok: true }>("DELETE", `/blocks/${id}`);
export const assignCurator = (id: string, curatorId: string | null) =>
  call<{ block: Block }>("PUT", `/blocks/${id}/curator`, { curatorId });
export const applyBlocksBulk = (yearId: string, residentIds: string[], fromWeek: number, blocks: BlockInput[]) =>
  call<{ ok: true; blocks: Block[] }>("POST", "/blocks/bulk", { yearId, residentIds, fromWeek, blocks });
export const generate = (p: { yearId: string; orgId?: string | null; residentIds?: string[]; fromWeek: number; seed?: number | null }) =>
  call<GenerateResult>("POST", "/generate", p);

export const createResident = (r: ResidentInput, yearId: string) => call<{ resident: Resident }>("POST", "/residents", { ...r, yearId });
export const updateResident = (id: string, r: ResidentInput) => call<{ resident: Resident }>("PUT", `/residents/${id}`, r);

export const updateWeeks = (yearId: string, weeks: { num: number; isRotation: boolean; note?: string | null }[]) =>
  call<{ weeks: Week[] }>("PUT", `/years/${yearId}/weeks`, { weeks });
export const createOverride = (yearId: string, o: { dateFrom: string; dateTo: string; kind: "off" | "on"; note?: string }) =>
  call<{ overrides: Override[] }>("POST", `/years/${yearId}/overrides`, o);
export const deleteOverride = (id: number) => call<{ overrides: Override[] }>("DELETE", `/overrides/${id}`);
export const setCurrentYear = (yearId: string) => call<{ years: Year[] }>("PUT", `/years/${yearId}/current`);

export const fetchUsers = () => call<{ users: User[] & { active: boolean }[] }>("GET", "/users");
export const createUser = (u: UserInput) => call<{ users: (User & { active: boolean })[] }>("POST", "/users", u);
export const updateUser = (id: number, u: UserInput) => call<{ users: (User & { active: boolean })[] }>("PUT", `/users/${id}`, u);
export const updateSettings = (s: { capacityThreshold?: number }) =>
  call<{ capacityThreshold: number }>("PUT", "/settings", s);

export const fetchAudit = (year: string) => call<{ entries: AuditEntry[] }>("GET", `/audit?year=${encodeURIComponent(year)}`);
