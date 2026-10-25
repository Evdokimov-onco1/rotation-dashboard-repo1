// Клиент для контракта Teaching preview API v1 (см. API.md).
// Endpoint относительный: приложение смонтировано на /teaching-preview/,
// хеш-навигация не меняет путь, поэтому './api.php' резолвится корректно.

export type Role = 'admin' | 'office' | 'approver' | 'teacher'

export interface User {
  id: number
  name: string
  roles: Role[]
  teacher_id: number | null
}

export interface YearInfo {
  id: string
  label: string
  months: string[]
}

export interface Teacher {
  id: number
  name: string
  rate: string
}

export interface Group {
  id: string
  course: number
  semester: number
  label: string
}

export interface WorkType {
  id: string
  label: string
  unit: string
  coefficient_cent: number
  integer_quantity: boolean
  daily_limited: boolean
}

export interface PlanRow {
  id: number
  teacher_id: number
  group_id: string
  discipline: string
  month: string
  type: string
  hours_cent: number
  source: string
  version: number
}

export type EventType = 'lecture' | 'seminar'
export type EventStatus = 'draft' | 'published' | 'cancelled'

export interface EventItem {
  id: number
  type: EventType
  title: string
  teacher_id: number
  group_id: string
  date: string
  start: string
  end: string
  hours_cent: number
  room: string
  status: EventStatus
  version: number
  plan_id: number | null
}

export type ClaimStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'returned'
  | 'cancelled'
  | 'superseded'

export interface Claim {
  id: number
  is_current_claimed?: boolean
  has_pending_correction?: boolean
  work_id: string
  revision: number
  version: number
  status: ClaimStatus
  type: string
  teacher_id: number
  group_id: string
  month: string
  date: string
  quantity: string
  hours_cent: number
  discipline: string
  event_id: number | null
  notes: string
  author_name: string
  rule_version: string
  formula: string
  supersedes_id: number | null
  comment: string
}

export interface Closure {
  teacher_id: number
  month: string
  closed_at: string
  closed_by: string
}

export interface ReportItem {
  id: number
  month: string
  group_id: string | null
  teacher_id: number | null
  draft: boolean
  created_at: string
  revision: number
  filename: string
}

export interface AuditItem {
  id: number
  created_at: string
  actor: string
  action: string
  detail: string
}

export interface Norms {
  version: string
  status: string
  daily_cap_cent: number
  annual_basis: number | null
  consultation_percent: number
}

export interface ImportSummary {
  filename: string
  rows: number
  total_cent: number
  created_at: string
}

export interface ImportPreview {
  token: string
  filename: string
  rows: number
  total_cent: number
  teachers: string[]
  monthly: Array<{ month: string; hours_cent: number }>
  warnings: string[]
  errors: string[]
  duplicate: boolean
}

export interface FullBootstrap {
  user: User
  csrf: string
  preview: boolean
  year: YearInfo
  teachers: Teacher[]
  groups: Group[]
  types: WorkType[]
  plans: PlanRow[]
  events: EventItem[]
  claims: Claim[]
  closures: Closure[]
  reports: ReportItem[]
  audit: AuditItem[]
  norms: Norms
  import_summary: ImportSummary | null
}

export interface AnonymousBootstrap {
  user: null
  csrf: string
  preview: boolean
}

export type BootstrapData = FullBootstrap | AnonymousBootstrap

export interface ReportSnapshot {
  month: string; preview: boolean; revision: number; total_cent: number; created_at: string
  blocks: Array<{group:Group; rows:Array<{teacher_id:number;teacher:string;hours:Record<string,number>;total_cent:number;claim_ids:number[]}>;totals:Record<string,number>;total_cent:number}>
}

export class ApiError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

let csrfToken = ''
export function setCsrf(token: string): void {
  csrfToken = token
}

let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn
}

async function parseResponse<T>(res: Response): Promise<T> {
  let parsed: { ok: boolean; data?: T; error?: { code: string; message: string } }
  try {
    parsed = await res.json()
  } catch {
    throw new ApiError('http_' + res.status, `Сервер вернул ответ ${res.status} без JSON.`)
  }
  if (res.status === 401 && parsed.error?.code !== 'login') onUnauthorized?.()
  if (!parsed.ok) {
    throw new ApiError(parsed.error?.code ?? 'error', parsed.error?.message ?? 'Ошибка сервера.')
  }
  return parsed.data as T
}

async function request<T>(action: string, payload?: unknown): Promise<T> {
  const isGet = payload === undefined
  const res = await fetch(`./api.php?action=${action}`, {
    method: isGet ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: isGet
      ? {}
      : {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
    body: isGet ? undefined : JSON.stringify(payload ?? {}),
  })
  return parseResponse<T>(res)
}

export async function importPreview(file: File): Promise<ImportPreview> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('./api.php?action=import.preview', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': csrfToken },
    body: fd,
  })
  return parseResponse<ImportPreview>(res)
}

export const api = {
  bootstrap: () => request<BootstrapData>('bootstrap'),
  login: (login: string, password: string) => request<{user: User; csrf:string}>('login', { login, password }),
  logout: () => request<unknown>('logout', {}),

  eventSave: (payload: {
    id?: number
    version?: number
    type: EventType
    title: string
    teacher_id: number
    group_id: string
    date: string
    start: string
    end: string
    hours_cent: number
    room: string
    plan_id?: number | null
  }) => request<EventItem>('event.save', payload),
  eventPublish: (id: number, version: number) =>
    request<EventItem>('event.publish', { id, version }),
  eventCancel: (id: number, version: number, comment: string) =>
    request<unknown>('event.cancel', { id, version, comment }),

  claimSave: (payload: {
    id?: number
    version?: number
    teacher_id: number
    group_id: string
    type: string
    month: string
    date: string
    quantity: string
    discipline: string
    event_id?: number | null
    notes: string
  }) => request<Claim>('claim.save', payload),
  claimCorrect: (id: number, version: number) =>
    request<Claim>('claim.correct', { id, version }),
  claimSubmit: (rows: Pick<Claim, 'id' | 'version'>[]) => request<{count:number}>('claim.submit', { ids: rows.map(r=>r.id), versions: Object.fromEntries(rows.map(r=>[r.id,r.version])) }),
  claimCancel: (id: number, version: number, comment: string) =>
    request<number>('claim.cancel', { id, version, comment }),
  claimReview: (rows: Pick<Claim, 'id' | 'version'>[], decision: 'approve' | 'return', comment: string) =>
    request<{count:number}>('claim.review', { ids:rows.map(r=>r.id), versions:Object.fromEntries(rows.map(r=>[r.id,r.version])), decision, comment }),

  monthClose: (teacher_id: number, month: string) =>
    request<unknown>('month.close', { teacher_id, month }),
  monthReopen: (teacher_id: number, month: string, comment: string) =>
    request<unknown>('month.reopen', { teacher_id, month, comment }),

  planSave: (id: number, version: number, hours_cent: number, reason: string) =>
    request<PlanRow>('plan.save', { id, version, hours_cent, reason }),

  importCommit: (token: string) => request<ImportSummary>('import.commit', { token }),

  reportCreate: (payload: {
    month: string
    group_id: string | null
    teacher_id: number | null
    draft: boolean
  }) => request<{ id: number; filename: string }>('report.create', payload),
  reportSnapshot: (id: number) => request<ReportSnapshot>(`report.snapshot&id=${id}`),
}

// ---------- форматирование и вычисления ----------

const hoursFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })

export function fmtHours(cent: number | null | undefined): string {
  if (cent === null || cent === undefined) return '—'
  return hoursFmt.format(cent / 100)
}

const monthFmt = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' })

export function monthName(month: string): string {
  const s = monthFmt.format(new Date(month + '-02T00:00:00'))
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export const shortMonthName = (month: string): string =>
  new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(new Date(month + '-02T00:00:00'))

export function parseQuantity(q: string): number | null {
  const n = Number(String(q).replace(',', '.').replace(/\s/g, ''))
  return Number.isFinite(n) ? n : null
}

export interface Scope {
  month: string | null // null = весь год
  teacherId: number | 'all'
  groupId: string | 'all'
}

// Последние действующие редакции записей: для каждой работы (work_id) берём
// запись с максимальной версией среди не отменённых и не заменённых;
// возвращённая правка (returned correction) откатывается на утверждённую редакцию.
export function latestRevisions(claims: Claim[]): Claim[] {
  if (claims.every(c => typeof c.is_current_claimed === 'boolean')) return claims.filter(c => c.is_current_claimed)
  const byWork = new Map<string, Claim[]>()
  for (const c of claims) {
    if (c.status === 'cancelled' || c.status === 'superseded') continue
    const arr = byWork.get(c.work_id)
    if (arr) arr.push(c)
    else byWork.set(c.work_id, [c])
  }
  const out: Claim[] = []
  for (const arr of byWork.values()) {
    let pick = arr[0]
    for (const c of arr) if (c.id > pick.id) pick = c
    if (pick.status === 'returned' && pick.supersedes_id) {
      const fallback = arr.find((c) => c.id === pick.supersedes_id && c.status === 'approved')
      if (fallback) pick = fallback
    }
    out.push(pick)
  }
  return out
}

export interface Metrics {
  planCent: number
  declaredCent: number // заявлено (последние редакции)
  submittedCent: number // на проверке
  approvedCent: number // подтверждено
}

export function computeMetrics(plans: PlanRow[], claims: Claim[], scope: Scope): Metrics {
  const planCent = plans
    .filter(
      (p) =>
        (scope.month === null || p.month === scope.month) &&
        (scope.teacherId === 'all' || p.teacher_id === scope.teacherId) &&
        (scope.groupId === 'all' || p.group_id === scope.groupId),
    )
    .reduce((s, p) => s + p.hours_cent, 0)

  const inScope = (c: Claim) =>
    (scope.month === null || c.month === scope.month) &&
    (scope.teacherId === 'all' || c.teacher_id === scope.teacherId) &&
    (scope.groupId === 'all' || c.group_id === scope.groupId)

  const revisions = latestRevisions(claims).filter(inScope)
  const declaredCent = revisions.reduce((s, c) => s + c.hours_cent, 0)
  const submittedCent = claims
    .filter((c) => c.status === 'submitted' && inScope(c))
    .reduce((s, c) => s + c.hours_cent, 0)
  const approvedCent = claims
    .filter((c) => c.status === 'approved' && inScope(c))
    .reduce((s, c) => s + c.hours_cent, 0)

  return { planCent, declaredCent, submittedCent, approvedCent }
}

export function isClosed(closures: Closure[], teacherId: number, month: string): boolean {
  return closures.some((c) => c.teacher_id === teacherId && c.month === month)
}
