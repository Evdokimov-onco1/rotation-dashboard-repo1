// Клиент REST API (см. backend/api). Запросы same-origin,
// привилегированная сессия — httpOnly-cookie, из JS недоступна.

import type { Block, Curator, Resident, Unit, Week } from "./data";

export interface Schedule {
  today: string;
  weeks: Week[]; units: Unit[]; curators: Curator[]; residents: Resident[];
  blocks: Block[];
  windows: { finishWorkdays: number; incomingDays: number; recentDays: number };
  authorized: boolean;
}

export interface AuditEntry {
  id: number; ts: string; action: string; blockId: string | null;
  old: Partial<Block> | null; new: Partial<Block> | null;
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

export const fetchSchedule = () => call<Schedule>("GET", "/schedule");
export const authPin = (pin: string) => call<{ ok: true }>("POST", "/auth/pin", { pin });
export const authLogout = () => call<{ ok: true }>("POST", "/auth/logout");
export const createBlock = (b: BlockInput) => call<{ block: Block }>("POST", "/blocks", b);
export const updateBlock = (id: string, b: BlockInput) => call<{ block: Block }>("PUT", `/blocks/${id}`, b);
export const deleteBlock = (id: string) => call<{ ok: true }>("DELETE", `/blocks/${id}`);
export const assignCurator = (id: string, curatorId: string | null) =>
  call<{ block: Block }>("PUT", `/blocks/${id}/curator`, { curatorId });
export const fetchAudit = () => call<{ entries: AuditEntry[] }>("GET", "/audit");
