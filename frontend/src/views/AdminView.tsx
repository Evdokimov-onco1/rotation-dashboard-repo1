import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  WEEKS, UNITS, RESIDENTS, ORGS, YEARS, SETTINGS, type Block, type Resident, type User,
  unitById, curatorById, residentById, orgById, blockRangeLabel, shortFio, yearLabel,
} from "../data";
import {
  errText, assignCurator, generate, applyBlocksBulk, createResident, updateResident,
  fetchUsers, createUser, updateUser, updateSettings, setCurrentYear, fetchAudit,
  type AuditEntry, type GenerateResult, type ResidentInput, type UserInput,
} from "../api";
import { blockStatus, overloads } from "../lib/calendar";
import { AMBER, PETROL, FieldLabel, LoginGate, SectionCard, canEditOrg, userScopeText } from "./common";

/* ──────────────────────────────── Журнал правок ──────────────────────────────── */

const ACTION_LABELS: Record<string, string> = {
  block_create: "создание блока",
  block_update: "изменение блока",
  block_delete: "удаление блока",
  curator_assign: "назначение куратора",
  generate_apply: "генерация ротации",
  seed_import: "загрузка данных года",
  resident_create: "новый ординатор",
  resident_update: "изменение ординатора",
  calendar_weeks: "правка недель календаря",
  calendar_override_add: "исключение по дням: добавлено",
  calendar_override_del: "исключение по дням: удалено",
  year_current: "смена текущего года",
  settings_update: "изменение настроек",
  user_create: "новый пользователь",
  user_update: "изменение пользователя",
};

function auditText(v: Record<string, unknown> | null): string {
  if (!v) return "";
  if (typeof v.residentId === "string" && typeof v.unitId === "string") {
    const r = RESIDENTS.find((x) => x.id === v.residentId);
    const u = UNITS.find((x) => x.id === v.unitId);
    const c = typeof v.curatorId === "string" ? curatorById(v.curatorId) : undefined;
    return [
      r ? shortFio(r.fio) : String(v.residentId),
      u ? u.short : String(v.unitId),
      v.from && v.to ? `недели ${v.from}–${v.to}` : "",
      v.curatorId ? `куратор ${c ? shortFio(c.fio) : v.curatorId}` : "куратор не назначен",
    ].filter(Boolean).join(" · ");
  }
  if (typeof v.fio === "string") return `${v.fio} · ${orgById(String(v.orgId))?.short ?? v.orgId} · ${v.year} год · ${v.mode === "fixed" ? "закреплён" : "ротация"}`;
  return Object.entries(v).map(([k, val]) => `${k}: ${Array.isArray(val) ? val.length + " шт." : typeof val === "object" && val ? JSON.stringify(val) : String(val)}`).join(" · ");
}

function AuditDialog({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetchAudit(SETTINGS.year).then((r) => setEntries(r.entries)).catch((e) => setErr(errText(e)));
  }, []);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="text-base">Журнал правок · {yearLabel()}</DialogTitle></DialogHeader>
        {err && <p className="text-sm text-red-700">{err}</p>}
        {!err && entries === null && <p className="text-sm text-muted-foreground">Загрузка…</p>}
        {entries !== null && entries.length === 0 && (
          <p className="text-sm text-muted-foreground">Правок пока не было.</p>
        )}
        {entries !== null && entries.length > 0 && (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {entries.map((e) => (
              <div key={e.id} className="border-b pb-2 text-sm last:border-0">
                <span className="mono text-xs text-muted-foreground">{e.ts}</span>{" "}
                <Badge variant="outline" className="ml-1 align-middle font-normal">
                  {ACTION_LABELS[e.action] ?? e.action}
                </Badge>
                {e.user && <span className="ml-2 text-xs text-muted-foreground">{e.user}</span>}
                <div>{auditText(e.new ?? e.old) || "—"}</div>
                {e.action !== "block_create" && e.old && e.new && (
                  <div className="text-xs text-muted-foreground">было: {auditText(e.old)}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ──────────────────────────────── Генератор ──────────────────────────────── */

function GeneratorCard({ user, blocks, onApplied }:
  { user: User; blocks: Block[]; onApplied: (blocks: Block[]) => void }) {
  const [orgId, setOrgId] = useState<string>(user.role === "dispatcher" ? (user.orgId ?? "") : "all");
  const [fromWeek, setFromWeek] = useState<number>(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);

  const rotationResidents = RESIDENTS.filter((r) => r.active && r.mode === "rotation" && (orgId === "all" || r.orgId === orgId));
  const withBlocks = rotationResidents.filter((r) => blocks.some((b) => b.residentId === r.id && b.from >= fromWeek)).length;

  const run = async (seed?: number) => {
    setBusy(true); setErr(null);
    try {
      const r = await generate({ yearId: SETTINGS.year, orgId: orgId === "all" ? null : orgId, fromWeek, seed: seed ?? null });
      setResult(r);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  const apply = async () => {
    if (!result) return;
    if (withBlocks > 0 && !window.confirm(`У ${withBlocks} ординаторов уже есть блоки с недели ${fromWeek}. Они будут заменены. Продолжить?`)) return;
    setBusy(true); setErr(null);
    try {
      const r = await applyBlocksBulk(result.yearId, result.residentIds, result.fromWeek, result.blocks);
      onApplied(r.blocks);
      setResult(null);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  return (
    <SectionCard title="Генератор ротации" accent={PETROL}
      hint="Строит блоки ординаторам в режиме «ротация» по программе года: ЦАОП, два длинных блока, четыре онкоотделения. Приоритет задаёт первый блок. Результат можно поправить вручную в матрице.">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <FieldLabel>Когорта</FieldLabel>
          <Select value={orgId} onValueChange={setOrgId} disabled={user.role === "dispatcher"}>
            <SelectTrigger className="w-[220px] bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              {user.role === "admin" && <SelectItem value="all">Все организации</SelectItem>}
              {ORGS.filter((o) => canEditOrg(user, o.id)).map((o) => <SelectItem key={o.id} value={o.id}>{o.short}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <FieldLabel>Пересобрать с недели</FieldLabel>
          <Select value={String(fromWeek)} onValueChange={(v) => setFromWeek(+v)}>
            <SelectTrigger className="w-[220px] bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>{WEEKS.map((w) => <SelectItem key={w.num} value={String(w.num)}>№{w.num} · {w.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Button onClick={() => void run()} disabled={busy || rotationResidents.length === 0}>{busy ? "…" : "Сгенерировать"}</Button>
        <span className="text-xs text-muted-foreground">
          ординаторов в ротации: {rotationResidents.length}{withBlocks > 0 && `, из них с блоками с недели ${fromWeek}: ${withBlocks}`}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Блоки до выбранной недели сохраняются, прошедшее можно править вручную. Превышение порога загрузки — предупреждение, не запрет.
      </p>
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}

      {result && (
        <Dialog open onOpenChange={(o) => !o && setResult(null)}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle className="text-base">
                Предпросмотр: {result.residentIds.length} ординаторов, {result.blocks.length} блоков · вариант №{result.seed}
              </DialogTitle>
            </DialogHeader>
            <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1 text-sm">
              {result.warnings.length > 0 && (
                <div className="rounded-[3px] border border-amber-300 bg-amber-50 px-3 py-2">
                  <div className="font-medium" style={{ color: AMBER }}>
                    Предупреждения · превышение порога {result.threshold}: {result.excess} человеко-недель
                  </div>
                  <ul className="mt-1 list-disc pl-5 text-xs text-neutral-700">
                    {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}
              <table className="w-full border-collapse text-xs">
                <tbody>
                  {result.residentIds.map((rid) => {
                    const r = residentById(rid);
                    const own = result.blocks.filter((b) => b.residentId === rid).sort((a, z) => a.from - z.from);
                    return (
                      <tr key={rid} className="border-b align-top last:border-0">
                        <td className="py-1 pr-3 whitespace-nowrap font-medium">{shortFio(r.fio)}
                          {r.priority && <span className="ml-1 font-normal text-muted-foreground">· {r.priority}</span>}</td>
                        <td className="py-1">
                          {own.map((b, i) => {
                            const u = unitById(b.unitId);
                            return (
                              <span key={i} className="mr-1 mb-1 inline-block rounded-[2px] px-1.5 py-0.5 text-white" style={{ background: u.color }}>
                                <span className="mono">{b.from}–{b.to}</span> {u.short}
                              </span>
                            );
                          })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => void run()} disabled={busy}>Другой вариант</Button>
              <Button variant="outline" onClick={() => setResult(null)} disabled={busy}>Отмена</Button>
              <Button onClick={() => void apply()} disabled={busy}>{busy ? "…" : "Применить"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </SectionCard>
  );
}

/* ──────────────────────────────── Ординаторы ──────────────────────────────── */

const EMPTY_RES: ResidentInput = { fio: "", orgId: "", year: 1, mode: "rotation", priority: null, active: true };

function ResidentDialog({ initial, id, user, onSaved, onClose }:
  { initial: ResidentInput; id: string | null; user: User; onSaved: (r: Resident) => void; onClose: () => void }) {
  const [s, setS] = useState<ResidentInput>({ ...initial, orgId: initial.orgId || (user.orgId ?? ORGS[0]?.id ?? "") });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = id ? await updateResident(id, s) : await createResident(s, SETTINGS.year);
      onSaved(r.resident); onClose();
    } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="text-base">{id ? "Ординатор" : "Новый ординатор"}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div><FieldLabel>ФИО</FieldLabel>
            <Input id="res-fio" value={s.fio} onChange={(e) => setS({ ...s, fio: e.target.value })} className="bg-white" /></div>
          <div className="flex gap-3">
            <div className="flex-1"><FieldLabel>Организация</FieldLabel>
              <Select value={s.orgId} onValueChange={(v) => setS({ ...s, orgId: v })} disabled={user.role === "dispatcher"}>
                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>{ORGS.map((o) => <SelectItem key={o.id} value={o.id}>{o.short} — {o.name}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="w-28"><FieldLabel>Год обучения</FieldLabel>
              <Select value={String(s.year)} onValueChange={(v) => setS({ ...s, year: +v })}>
                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="1">1</SelectItem><SelectItem value="2">2</SelectItem><SelectItem value="3">3</SelectItem></SelectContent>
              </Select></div>
          </div>
          <div><FieldLabel>Режим</FieldLabel>
            <Select value={s.mode} onValueChange={(v) => setS({ ...s, mode: v as "rotation" | "fixed" })}>
              <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rotation">ротация по графику (генератор)</SelectItem>
                <SelectItem value="fixed">закреплён за отделением (блоки вручную)</SelectItem>
              </SelectContent>
            </Select></div>
          <div><FieldLabel>Приоритет из анкеты (ХТ, ЛТ, маммология, абдоминальная хирургия, НЭО…)</FieldLabel>
            <Input id="res-priority" value={s.priority ?? ""} onChange={(e) => setS({ ...s, priority: e.target.value || null })} className="bg-white" placeholder="не известно" /></div>
          <label className="flex items-center gap-2 text-sm">
            <input id="res-active" type="checkbox" checked={s.active !== false} onChange={(e) => setS({ ...s, active: e.target.checked })} />
            активен (отключённые не показываются в матрице и кабинетах)
          </label>
          {msg && <p className="text-sm text-red-700">{msg}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Отмена</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? "…" : "Сохранить"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResidentsCard({ user, onChanged }: { user: User; onChanged: (r: Resident) => void }) {
  const [editing, setEditing] = useState<{ id: string | null; data: ResidentInput } | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const mine = RESIDENTS.filter((r) => canEditOrg(user, r.orgId) && (showInactive || r.active))
    .sort((a, z) => (a.orgId + a.year + a.fio).localeCompare(z.orgId + z.year + z.fio, "ru"));
  return (
    <SectionCard title={`Ординаторы · ${mine.length}`}
      actions={<Button variant="outline" size="sm" onClick={() => setEditing({ id: null, data: EMPTY_RES })}>+ Добавить</Button>}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="caps-label text-[10px] text-muted-foreground">
              <th className="border-b px-2 py-1 text-left">ФИО</th>
              <th className="border-b px-2 py-1 text-left">Орг.</th>
              <th className="border-b px-2 py-1 text-left">Год</th>
              <th className="border-b px-2 py-1 text-left">Режим</th>
              <th className="border-b px-2 py-1 text-left">Приоритет</th>
              <th className="border-b px-2 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {mine.map((r) => (
              <tr key={r.id} className={r.active ? "" : "text-muted-foreground line-through"}>
                <td className="border-b px-2 py-1">{r.fio}</td>
                <td className="border-b px-2 py-1">{orgById(r.orgId)?.short}</td>
                <td className="mono border-b px-2 py-1">{r.year}</td>
                <td className="border-b px-2 py-1 text-xs">{r.mode === "fixed" ? "закреплён" : "ротация"}</td>
                <td className="border-b px-2 py-1 text-xs">{r.priority ?? "—"}</td>
                <td className="border-b px-2 py-1 text-right">
                  <Button variant="ghost" size="sm" onClick={() => setEditing({ id: r.id, data: { fio: r.fio, orgId: r.orgId, year: r.year, mode: r.mode, priority: r.priority, active: r.active } })}>Изменить</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <input id="show-inactive" type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> показывать отключённых
      </label>
      {editing && <ResidentDialog initial={editing.data} id={editing.id} user={user} onSaved={onChanged} onClose={() => setEditing(null)} />}
    </SectionCard>
  );
}

/* ──────────────────────────────── Пользователи ──────────────────────────────── */

type UserRow = User & { active: boolean };

function UsersCard() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number | null; data: UserInput } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetchUsers().then((r) => setUsers(r.users as UserRow[])).catch((e) => setErr(errText(e))); }, []);

  const save = async () => {
    if (!editing) return;
    setBusy(true); setErr(null);
    try {
      const r = editing.id ? await updateUser(editing.id, editing.data) : await createUser(editing.data);
      setUsers(r.users as UserRow[]); setEditing(null);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const d = editing?.data;
  return (
    <SectionCard title="Пользователи" hint="Учебная часть видит и правит всё; распорядитель — только ординаторов своей организации."
      actions={<Button variant="outline" size="sm" onClick={() => setEditing({ id: null, data: { login: "", name: "", role: "dispatcher", orgId: ORGS[0]?.id ?? null, password: "" } })}>+ Добавить</Button>}>
      {err && <p className="mb-2 text-sm text-red-700">{err}</p>}
      {users === null && !err && <p className="text-sm text-muted-foreground">Загрузка…</p>}
      {users && users.map((u) => (
        <div key={u.id} className={"flex flex-wrap items-center gap-3 border-b py-1.5 text-sm last:border-0 " + (u.active ? "" : "text-muted-foreground line-through")}>
          <span className="mono w-32">{u.login}</span>
          <span className="min-w-0 flex-1">{u.name}</span>
          <span className="text-xs text-muted-foreground">{u.role === "admin" ? "учебная часть" : `распорядитель · ${orgById(u.orgId ?? "")?.short ?? ""}`}</span>
          <Button variant="ghost" size="sm" onClick={() => setEditing({ id: u.id, data: { name: u.name, role: u.role, orgId: u.orgId, password: "", active: u.active } })}>Изменить</Button>
        </div>
      ))}
      {editing && d && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle className="text-base">{editing.id ? "Пользователь" : "Новый пользователь"}</DialogTitle></DialogHeader>
            <div className="space-y-3 text-sm">
              {!editing.id && <div><FieldLabel>Логин (латиница)</FieldLabel>
                <Input id="u-login" value={d.login ?? ""} onChange={(e) => setEditing({ ...editing, data: { ...d, login: e.target.value } })} className="bg-white" /></div>}
              <div><FieldLabel>Имя (как показывать)</FieldLabel>
                <Input id="u-name" value={d.name} onChange={(e) => setEditing({ ...editing, data: { ...d, name: e.target.value } })} className="bg-white" /></div>
              <div><FieldLabel>Роль</FieldLabel>
                <Select value={d.role} onValueChange={(v) => setEditing({ ...editing, data: { ...d, role: v as "admin" | "dispatcher" } })}>
                  <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="admin">учебная часть (всё)</SelectItem><SelectItem value="dispatcher">распорядитель когорты</SelectItem></SelectContent>
                </Select></div>
              {d.role === "dispatcher" && <div><FieldLabel>Организация</FieldLabel>
                <Select value={d.orgId ?? ""} onValueChange={(v) => setEditing({ ...editing, data: { ...d, orgId: v } })}>
                  <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>{ORGS.map((o) => <SelectItem key={o.id} value={o.id}>{o.short}</SelectItem>)}</SelectContent>
                </Select></div>}
              <div><FieldLabel>{editing.id ? "Новый пароль (пусто — не менять)" : "Пароль (не короче 6 символов)"}</FieldLabel>
                <Input id="u-password" type="password" autoComplete="new-password" value={d.password ?? ""} onChange={(e) => setEditing({ ...editing, data: { ...d, password: e.target.value } })} className="bg-white" /></div>
              {editing.id && <label className="flex items-center gap-2"><input id="u-active" type="checkbox" checked={d.active !== false} onChange={(e) => setEditing({ ...editing, data: { ...d, active: e.target.checked } })} /> активен</label>}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>Отмена</Button>
              <Button onClick={() => void save()} disabled={busy}>{busy ? "…" : "Сохранить"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </SectionCard>
  );
}

/* ──────────────────────────────── Настройки ──────────────────────────────── */

function SettingsCard({ onYearsChanged, onThresholdChanged }: { onYearsChanged: () => void; onThresholdChanged: (n: number) => void }) {
  const [threshold, setThreshold] = useState(String(SETTINGS.capacityThreshold));
  const [msg, setMsg] = useState<string | null>(null);
  const current = YEARS.find((y) => y.isCurrent)?.id ?? "";
  const saveThreshold = async () => {
    setMsg(null);
    try {
      const r = await updateSettings({ capacityThreshold: +threshold });
      onThresholdChanged(r.capacityThreshold); setMsg("Сохранено.");
    } catch (e) { setMsg(errText(e)); }
  };
  const makeCurrent = async (id: string) => {
    setMsg(null);
    try { await setCurrentYear(id); onYearsChanged(); setMsg("Текущий год изменён."); } catch (e) { setMsg(errText(e)); }
  };
  return (
    <SectionCard title="Настройки">
      <div className="flex flex-wrap items-end gap-3">
        <div><FieldLabel>Порог загрузки, чел. в подразделении</FieldLabel>
          <Input id="threshold" type="number" min={1} max={60} value={threshold} onChange={(e) => setThreshold(e.target.value)} className="w-28 bg-white" /></div>
        <Button variant="outline" onClick={() => void saveThreshold()}>Сохранить порог</Button>
        <div className="ml-4"><FieldLabel>Текущий учебный год (открывается по умолчанию)</FieldLabel>
          <Select value={current} onValueChange={(v) => void makeCurrent(v)}>
            <SelectTrigger className="w-[200px] bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>{YEARS.map((y) => <SelectItem key={y.id} value={y.id}>{y.label}</SelectItem>)}</SelectContent>
          </Select></div>
      </div>
      {msg && <p className="mt-2 text-xs text-muted-foreground">{msg}</p>}
      <p className="mt-2 text-xs text-muted-foreground">Новый учебный год загружается сид-файлом на сервере (см. README), архив прошлых лет остаётся доступен через переключатель в шапке.</p>
    </SectionCard>
  );
}

/* ──────────────────────────────── Админка ──────────────────────────────── */

export function AdminView({ blocks, date, user, onLogin, onLogout, openEditor, onBlockChanged, onBlocksReplaced, onResidentChanged, onYearsChanged, onThresholdChanged }:
  {
    blocks: Block[]; date: string; user: User | null;
    onLogin: (u: User) => void; onLogout: () => void;
    openEditor: (b: Block | null) => void;
    onBlockChanged: (b: Block) => void;
    onBlocksReplaced: (blocks: Block[]) => void;
    onResidentChanged: (r: Resident) => void;
    onYearsChanged: () => void;
    onThresholdChanged: (n: number) => void;
  }) {
  const [err, setErr] = useState<string | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  // хуки — до раннего выхода на форму входа
  const over = useMemo(() => overloads(blocks), [blocks, SETTINGS.capacityThreshold]);

  if (!user) {
    return (
      <LoginGate
        title="Вход для учебной части и распорядителей"
        desc="Просмотр открыт всем. Для правки графика, генерации ротации и назначения кураторов войдите."
        onLogin={onLogin}
      />
    );
  }

  const unassigned = blocks
    .filter((b) => !b.curatorId && residentById(b.residentId)?.active && canEditOrg(user, residentById(b.residentId).orgId) && blockStatus(b, date) !== "past")
    .sort((a, z) => a.from - z.from);

  const assign = async (id: string, curatorId: string) => {
    setErr(null);
    try {
      const { block } = await assignCurator(id, curatorId);
      onBlockChanged(block);
    } catch (e) {
      setErr(errText(e));
    }
  };

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Вы вошли как <span className="font-medium text-foreground">{user.name}</span> · {userScopeText(user)}.
          Любой блок в «Матрице» открывается на правку по клику.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => openEditor(null)}>+ Добавить блок</Button>
          <Button variant="outline" onClick={() => setAuditOpen(true)}>Журнал правок</Button>
          <Button variant="ghost" onClick={onLogout}>Выйти</Button>
        </div>
      </div>

      {err && <p className="text-sm text-red-700">{err}</p>}

      <GeneratorCard user={user} blocks={blocks} onApplied={onBlocksReplaced} />

      {over.length > 0 && (
        <SectionCard accent={AMBER} className="bg-amber-50/60"
          title={`Загрузка выше порога (${SETTINGS.capacityThreshold} чел.) · ${over.length}`}
          hint="Справочно: где одновременно больше ординаторов, чем задано порогом. Не блокирует, но стоит посмотреть.">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {over.map((o, i) => (
              <span key={i}>
                <span className="mr-1 inline-block h-2.5 w-2.5 rounded-[2px] align-middle" style={{ background: unitById(o.unitId).color }} />
                {unitById(o.unitId).short} <span className="mono text-xs">нед. {o.from}–{o.to}</span> · {o.count} чел.
              </span>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard accent={AMBER}
        title={`Требуют назначения куратора${unassigned.length ? " · " + unassigned.length : ""}`}>
        {unassigned.length === 0 && <p className="text-sm text-muted-foreground">Все блоки распределены.</p>}
        {unassigned.map((b) => {
          const u = unitById(b.unitId);
          const r = residentById(b.residentId);
          return (
            <div key={b.id} className="flex flex-wrap items-center gap-3 border-b py-2 last:border-0">
              <span className="h-3 w-3 shrink-0 rounded-[2px]" style={{ background: u.color }} />
              <div className="min-w-[260px] flex-1">
                <div className="text-sm font-medium">{r.fio} <span className="text-xs font-normal text-muted-foreground">{orgById(r.orgId)?.short} · {r.year} год</span></div>
                <div className="text-xs text-muted-foreground">
                  {u.name} · <span className="mono">{blockRangeLabel(b)}</span>
                </div>
              </div>
              <Select onValueChange={(v) => void assign(b.id, v)}>
                <SelectTrigger className="w-[320px] bg-white">
                  <SelectValue placeholder="Выбрать куратора…" />
                </SelectTrigger>
                <SelectContent>
                  {u.candidates.map((cid) => {
                    const c = curatorById(cid)!;
                    return <SelectItem key={cid} value={cid}>{c.fio}{c.note ? ` — ${c.note}` : ""}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </SectionCard>

      <ResidentsCard user={user} onChanged={onResidentChanged} />

      {user.role === "admin" && <UsersCard />}
      {user.role === "admin" && <SettingsCard onYearsChanged={onYearsChanged} onThresholdChanged={onThresholdChanged} />}

      <p className="text-xs text-muted-foreground">
        Каждая правка сохраняется на сервере и попадает в журнал правок с именем пользователя.
      </p>

      {auditOpen && <AuditDialog onClose={() => setAuditOpen(false)} />}
    </div>
  );
}
