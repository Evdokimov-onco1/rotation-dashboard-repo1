import { useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  WEEKS, UNITS, CURATORS, RESIDENTS, INITIAL_BLOCKS,
  type Block, weekByNum, unitById, curatorById, residentById,
  fmtD, blockRangeLabel, shortFio,
} from "./data";

/* палитра «Пост отделения» */
const INK = "#16323c";
const PETROL = "#0f4c5c";
const AMBER = "#b45309";

type Status = "past" | "current" | "future";

function blockStatus(bl: Block, date: string): Status {
  if (weekByNum(bl.to).end < date) return "past";
  if (weekByNum(bl.from).start > date) return "future";
  return "current";
}

function currentWeekNum(date: string): number | null {
  const w = WEEKS.find((w) => w.start <= date && date <= w.end);
  return w ? w.num : null;
}

const toIso = (d: Date) => d.toISOString().slice(0, 10);

function subWorkdays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() - 1);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return toIso(d);
}

function diffDays(a: string, b: string): number {
  return Math.round((+new Date(b + "T00:00:00") - +new Date(a + "T00:00:00")) / 86400000);
}

/** блок в предпоследнем/последнем дне курации */
function isFinishing(bl: Block, date: string): boolean {
  return blockStatus(bl, date) === "current" && date >= subWorkdays(weekByNum(bl.to).end, 1);
}

/** до старта блока осталось 1–3 календарных дня */
function isComingSoon(bl: Block, date: string): boolean {
  const dd = diffDays(date, weekByNum(bl.from).start);
  return dd >= 1 && dd <= 3;
}

function nextBlockFor(blocks: Block[], residentId: string, afterWeek: number): Block | null {
  return blocks
    .filter((b) => b.residentId === residentId && b.from > afterWeek)
    .sort((a, z) => a.from - z.from)[0] ?? null;
}

function nextDestText(blocks: Block[], bl: Block): string {
  const nb = nextBlockFor(blocks, bl.residentId, bl.to);
  if (!nb) return "ротации по графику завершены";
  const u = unitById(nb.unitId);
  const cur = nb.curatorId
    ? `куратор: ${shortFio(curatorById(nb.curatorId)!.fio)}`
    : "⚠️ куратор не назначен";
  return `${u.name}, с ${fmtD(weekByNum(nb.from).start)} · ${cur}`;
}

/* ────────────────────────────── Общие мелкие компоненты ────────────────────────────── */

function PinGate({ title, desc, onUnlock }: { title: string; desc: string; onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);
  const tryPin = () => (pin === "1234" ? onUnlock() : setErr(true));
  return (
    <Card className="max-w-sm">
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {desc}
          <br /><span className="opacity-60">(в прототипе: 1234)</span>
        </p>
        <div className="flex gap-2">
          <Input type="password" inputMode="numeric" placeholder="PIN" value={pin}
            onChange={(e) => { setPin(e.target.value); setErr(false); }}
            onKeyDown={(e) => e.key === "Enter" && tryPin()}
            className="w-32 mono" />
          <Button onClick={tryPin}>Войти</Button>
        </div>
        {err && <p className="text-sm text-red-700">Неверный PIN.</p>}
      </CardContent>
    </Card>
  );
}

function UnitDot({ unitId }: { unitId: string }) {
  return <span className="mt-1 h-3 w-3 shrink-0 rounded-[2px]" style={{ background: unitById(unitId).color }} />;
}

function SectionCard({ title, hint, accent, children, className = "" }:
  { title: string; hint?: string; accent?: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={"border " + className} style={accent ? { borderLeft: `3px solid ${accent}` } : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="text-[15px]">{title}</CardTitle>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/* ─────────────────────────────── Кабинет куратора ─────────────────────────────── */

function CuratorView({ blocks, date }: { blocks: Block[]; date: string }) {
  const [curatorId, setCuratorId] = useState<string>("levitskiy");
  const mine = blocks.filter((b) => b.curatorId === curatorId);
  const maybe = blocks.filter(
    (b) => !b.curatorId && unitById(b.unitId).candidates.includes(curatorId)
  );
  const current = mine.filter((b) => blockStatus(b, date) === "current");
  const recent = mine
    .filter((b) => blockStatus(b, date) === "past" && diffDays(weekByNum(b.to).end, date) <= 14)
    .sort((a, z) => weekByNum(z.to).end.localeCompare(weekByNum(a.to).end));
  const future = mine
    .filter((b) => blockStatus(b, date) === "future")
    .sort((a, z) => weekByNum(a.from).start.localeCompare(weekByNum(z.from).start));

  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="caps-label text-[11px] text-muted-foreground">Я — заведующий</span>
        <Select value={curatorId} onValueChange={setCuratorId}>
          <SelectTrigger className="w-[430px] bg-white"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CURATORS.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.fio}{c.note ? ` — ${c.note}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4">
        <SectionCard title="Сейчас у вас на ротации" accent={PETROL}
          hint="Логбук подписывается за каждый день посещения.">
          {current.length === 0 && <p className="text-sm text-muted-foreground">Сейчас никого нет.</p>}
          {current.map((b) => {
            const fin = isFinishing(b, date);
            return (
              <div key={b.id} className="flex items-start gap-3 border-b py-2.5 last:border-0">
                <UnitDot unitId={b.unitId} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {residentById(b.residentId).fio}
                    <span className="ml-2 mono text-xs text-muted-foreground">до {fmtD(weekByNum(b.to).end)}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {unitById(b.unitId).name} · <span className="mono text-[13px]">{blockRangeLabel(b)}</span>
                  </div>
                  {fin && (
                    <div className="mt-1.5 rounded-[3px] border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-sm">
                      <span className="font-medium" style={{ color: AMBER }}>
                        Завершается {fmtD(weekByNum(b.to).end)} — доподпишите логбук за все дни.
                      </span>
                      <br />
                      <span className="text-neutral-700">Далее ординатор идёт: {nextDestText(blocks, b)}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </SectionCard>

        <SectionCard title="Придут к вам">
          {future.length === 0 && <p className="text-sm text-muted-foreground">Запланированных ротаций нет.</p>}
          {future.slice(0, 4).map((b) => {
            const soon = isComingSoon(b, date);
            const dd = diffDays(date, weekByNum(b.from).start);
            return (
              <div key={b.id} className="flex items-start gap-3 border-b py-2 last:border-0">
                <UnitDot unitId={b.unitId} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {residentById(b.residentId).fio}
                    {soon ? (
                      <Badge className="ml-2 align-middle" style={{ background: AMBER }}>
                        через {dd} {dd === 1 ? "день" : "дн."} · {fmtD(weekByNum(b.from).start)}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="ml-2 mono align-middle font-normal">
                        с {fmtD(weekByNum(b.from).start)}
                      </Badge>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {unitById(b.unitId).name} · <span className="mono text-[13px]">{blockRangeLabel(b)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </SectionCard>

        {recent.length > 0 && (
          <SectionCard title="Завершились недавно" hint="Справочно, за последние две недели.">
            {recent.map((b) => (
              <div key={b.id} className="flex items-start gap-3 border-b py-1.5 text-sm text-muted-foreground last:border-0">
                <UnitDot unitId={b.unitId} />
                <span>
                  {residentById(b.residentId).fio} — {unitById(b.unitId).short},{" "}
                  <span className="mono text-[13px]">недели {b.from}–{b.to}</span>, завершилась {fmtD(weekByNum(b.to).end)}
                </span>
              </div>
            ))}
          </SectionCard>
        )}

        {maybe.length > 0 && (
          <SectionCard title="Возможно, ваши" accent={AMBER} className="bg-amber-50/60"
            hint="Ротации в подразделении, где вы — один из возможных кураторов. Назначение делает администратор.">
            {maybe.map((b) => (
              <div key={b.id} className="flex items-start gap-3 border-b py-2 last:border-0">
                <UnitDot unitId={b.unitId} />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{residentById(b.residentId).fio}</div>
                  <div className="text-sm text-muted-foreground">
                    {unitById(b.unitId).name} · <span className="mono text-[13px]">{blockRangeLabel(b)}</span>
                  </div>
                  <div className="text-sm" style={{ color: AMBER }}>⚠️ куратор не назначен</div>
                </div>
              </div>
            ))}
          </SectionCard>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────────── Матрица (Гант) ──────────────────────────────── */

function Matrix({ blocks, date, onCellClick }:
  { blocks: Block[]; date: string; onCellClick: (b: Block) => void }) {
  const curW = currentWeekNum(date);

  const rows = RESIDENTS.map((r) => {
    const own = blocks
      .filter((b) => b.residentId === r.id)
      .sort((a, z) => a.from - z.from);
    const cells: React.ReactNode[] = [];
    let w = 1;
    for (const bl of own) {
      for (; w < bl.from; w++) cells.push(<td key={"e" + w} className="border border-border bg-muted/60" />);
      const u = unitById(bl.unitId);
      const isCur = curW !== null && bl.from <= curW && curW <= bl.to;
      cells.push(
        <td
          key={bl.id}
          colSpan={bl.to - bl.from + 1}
          onClick={() => onCellClick(bl)}
          title={`${u.name}, ${blockRangeLabel(bl)}${bl.curatorId ? "\nКуратор: " + curatorById(bl.curatorId)!.fio : "\n⚠️ куратор не назначен"}`}
          className={"cursor-pointer border px-1 py-1.5 text-center text-[11px] font-medium leading-tight text-white select-none " +
            (isCur ? "ring-2 ring-inset " : "") +
            (!bl.curatorId ? "border-dashed border-amber-600" : "border-white/40")}
          style={{
            background: u.color,
            opacity: blockStatus(bl, date) === "past" ? 0.5 : 1,
            ...(isCur ? { ["--tw-ring-color" as any]: INK } : {}),
          }}
        >
          {u.short}{!bl.curatorId && " ⚠️"}
        </td>
      );
      w = bl.to + 1;
    }
    for (; w <= 35; w++) cells.push(<td key={"e" + w} className="border border-border bg-muted/60" />);
    return (
      <tr key={r.id}>
        <th className="sticky left-0 z-10 border border-border bg-white px-2 py-1 text-left text-xs font-medium whitespace-nowrap">
          {shortFio(r.fio)}
        </th>
        {cells}
      </tr>
    );
  });

  return (
    <div>
      <div className="overflow-x-auto border border-border bg-white">
        <table className="border-collapse" style={{ minWidth: 1180 }}>
          <thead>
            <tr>
              <th className="caps-label sticky left-0 z-10 border border-border bg-white px-2 py-1 text-left text-[10px] font-normal text-muted-foreground">
                Ординатор · неделя
              </th>
              {WEEKS.map((wk) => (
                <th key={wk.num} title={wk.label}
                  className="mono border border-border px-0.5 py-1 text-center text-[10px] font-normal"
                  style={wk.num === curW
                    ? { background: PETROL, color: "#fff" }
                    : { background: "hsl(160 10% 93%)", color: "#5b6b70" }}>
                  {wk.num}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {UNITS.filter((u) => blocks.some((b) => b.unitId === u.id)).map((u) => (
          <span key={u.id} className="flex items-center gap-1.5 text-xs text-neutral-700">
            <span className="h-3 w-3 rounded-[2px]" style={{ background: u.color }} /> {u.short} — {u.name}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Пунктир и ⚠️ — куратор не назначен · тёмная рамка — текущая неделя · блеклые блоки завершились ·
        клик по блоку — карточка (в режиме администратора — редактирование).
      </p>
    </div>
  );
}

/* ───────────────────────────── Кабинет учебной части ───────────────────────────── */

function EduView({ blocks, date, unlocked, setUnlocked }:
  { blocks: Block[]; date: string; unlocked: boolean; setUnlocked: (v: boolean) => void }) {
  if (!unlocked) {
    return (
      <PinGate
        title="Кабинет учебной части"
        desc="Сводка задач кураторов на сегодня. Доступ по PIN-коду (тот же, что у админки)."
        onUnlock={() => setUnlocked(true)}
      />
    );
  }

  interface Tasks { finish: Block[]; incoming: Block[]; nowCount: number; }
  const byCurator = new Map<string, Tasks>();
  const ensure = (cid: string) => {
    if (!byCurator.has(cid)) byCurator.set(cid, { finish: [], incoming: [], nowCount: 0 });
    return byCurator.get(cid)!;
  };
  const unassigned: Block[] = [];

  for (const b of blocks) {
    if (!b.curatorId) { unassigned.push(b); continue; }
    const st = blockStatus(b, date);
    if (st === "current") {
      const t = ensure(b.curatorId);
      t.nowCount++;
      if (isFinishing(b, date)) t.finish.push(b);
    } else if (st === "future" && isComingSoon(b, date)) {
      ensure(b.curatorId).incoming.push(b);
    }
  }
  unassigned.sort((a, z) => a.from - z.from);

  const rows = [...byCurator.entries()]
    .filter(([, t]) => t.finish.length > 0 || t.incoming.length > 0)
    .sort((a, z) => z[1].finish.length - a[1].finish.length);
  const totalFinish = rows.reduce((s, [, t]) => s + t.finish.length, 0);
  const totalIncoming = rows.reduce((s, [, t]) => s + t.incoming.length, 0);

  const stat = (n: number, label: string, warn = false) => (
    <div className={"border px-4 py-2 " + (warn && n > 0 ? "border-amber-400 bg-amber-50" : "border-border bg-white")}>
      <div className="mono text-2xl font-semibold leading-none">{n}</div>
      <div className="caps-label mt-1 text-[10px] text-muted-foreground">{label}</div>
    </div>
  );

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          {stat(totalFinish, "завершаются — доподписать")}
          {stat(totalIncoming, "приходят в ближайшие 3 дня")}
          {stat(unassigned.length, "блоков без куратора", true)}
        </div>
        <Button variant="ghost" onClick={() => setUnlocked(false)}>Выйти</Button>
      </div>

      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">На сегодня задач у кураторов нет.</p>
      )}

      {rows.map(([cid, t]) => {
        const c = curatorById(cid)!;
        return (
          <Card key={cid}>
            <CardHeader className="pb-2">
              <CardTitle className="text-[15px]">
                {c.fio} <span className="text-sm font-normal text-muted-foreground">— {c.note}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {t.finish.map((b) => (
                <div key={b.id} className="text-sm">
                  <Badge className="mr-2 align-middle" style={{ background: AMBER }}>доподписать логбук</Badge>
                  {residentById(b.residentId).fio} — {unitById(b.unitId).short},{" "}
                  последний день <span className="mono">{fmtD(weekByNum(b.to).end)}</span>
                  <span className="text-muted-foreground"> · далее: {nextDestText(blocks, b)}</span>
                </div>
              ))}
              {t.incoming.map((b) => (
                <div key={b.id} className="text-sm">
                  <Badge variant="outline" className="mr-2 align-middle">принимает</Badge>
                  {residentById(b.residentId).fio} — {unitById(b.unitId).short},{" "}
                  с <span className="mono">{fmtD(weekByNum(b.from).start)}</span>{" "}
                  <span className="mono text-muted-foreground">(недели {b.from}–{b.to})</span>
                </div>
              ))}
              {t.nowCount > 0 && (
                <p className="pt-1 text-xs text-muted-foreground">
                  сейчас на ротации: {t.nowCount} чел. — ежедневная подпись логбука
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}

      {unassigned.length > 0 && (
        <SectionCard title="Ваша задача: назначить кураторов" accent={AMBER} className="bg-amber-50/60">
          {unassigned.map((b) => {
            const u = unitById(b.unitId);
            return (
              <div key={b.id} className="flex items-center gap-2 border-b border-amber-200 py-1.5 text-sm last:border-0">
                <span className="h-3 w-3 shrink-0 rounded-[2px]" style={{ background: u.color }} />
                <span className="min-w-0 flex-1">
                  {residentById(b.residentId).fio} — {u.name},{" "}
                  <span className="mono text-[13px]">{blockRangeLabel(b)}</span>
                </span>
                <Badge variant="outline" className="mono shrink-0 font-normal">
                  старт {fmtD(weekByNum(b.from).start)}
                </Badge>
              </div>
            );
          })}
          <p className="pt-2 text-xs text-muted-foreground">Назначение — во вкладке «Админка».</p>
        </SectionCard>
      )}

      <p className="text-xs text-muted-foreground">
        «Доподписать» появляется в предпоследний и последний день курации, «принимает» — за 3 дня до
        начала ротации: те же окна, что у Telegram-напоминаний.
      </p>
    </div>
  );
}

/* ──────────────────────────────────── Админка ──────────────────────────────────── */

function AdminView({ blocks, setBlocks, unlocked, setUnlocked, openEditor }:
  {
    blocks: Block[]; setBlocks: (b: Block[]) => void;
    unlocked: boolean; setUnlocked: (v: boolean) => void;
    openEditor: (b: Block | null) => void;
  }) {
  if (!unlocked) {
    return (
      <PinGate
        title="Режим администратора"
        desc="Просмотр открыт всем. Для редактирования графика введите PIN-код."
        onUnlock={() => setUnlocked(true)}
      />
    );
  }

  const unassigned = blocks
    .filter((b) => !b.curatorId)
    .sort((a, z) => a.from - z.from);

  const assign = (id: string, curatorId: string) =>
    setBlocks(blocks.map((b) => (b.id === id ? { ...b, curatorId } : b)));

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Редактирование включено. Любой блок в «Матрице» открывается на правку по клику.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => openEditor(null)}>+ Добавить блок</Button>
          <Button variant="ghost" onClick={() => setUnlocked(false)}>Выйти</Button>
        </div>
      </div>

      <SectionCard accent={AMBER}
        title={`Требуют назначения куратора${unassigned.length ? " · " + unassigned.length : ""}`}>
        {unassigned.length === 0 && <p className="text-sm text-muted-foreground">Все блоки распределены.</p>}
        {unassigned.map((b) => {
          const u = unitById(b.unitId);
          return (
            <div key={b.id} className="flex flex-wrap items-center gap-3 border-b py-2 last:border-0">
              <span className="h-3 w-3 shrink-0 rounded-[2px]" style={{ background: u.color }} />
              <div className="min-w-[260px] flex-1">
                <div className="text-sm font-medium">{residentById(b.residentId).fio}</div>
                <div className="text-xs text-muted-foreground">
                  {u.name} · <span className="mono">{blockRangeLabel(b)}</span>
                </div>
              </div>
              <Select onValueChange={(v) => assign(b.id, v)}>
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

      <p className="text-xs text-muted-foreground">
        Прототип: изменения хранятся только в этой вкладке браузера. В боевой версии каждая правка
        сохраняется на сервере и попадает в журнал изменений.
      </p>
    </div>
  );
}

/* ───────────────────────────── Диалог блока / редактор ───────────────────────────── */

interface EditorState {
  id: string | null; residentId: string; unitId: string;
  from: number; to: number; curatorId: string | null;
}

function BlockDialog({ state, setState, admin, blocks, setBlocks, onClose }:
  {
    state: EditorState; setState: (s: EditorState) => void; admin: boolean;
    blocks: Block[]; setBlocks: (b: Block[]) => void; onClose: () => void;
  }) {
  const u = unitById(state.unitId);
  const isNew = state.id === null;
  const [msg, setMsg] = useState<string | null>(null);

  const overlap = () =>
    blocks.some((b) =>
      b.id !== state.id && b.residentId === state.residentId &&
      !(state.to < b.from || b.to < state.from));

  const save = () => {
    if (state.from > state.to) { setMsg("Неделя начала позже недели окончания."); return; }
    if (overlap()) { setMsg("Пересекается с другим блоком этого ординатора."); return; }
    const auto = u.rule === "auto" ? u.candidates[0] : state.curatorId;
    const nb: Block = {
      id: state.id ?? "b" + Math.random().toString(36).slice(2, 8),
      residentId: state.residentId, unitId: state.unitId,
      from: state.from, to: state.to, curatorId: auto,
    };
    setBlocks(isNew ? [...blocks, nb] : blocks.map((b) => (b.id === nb.id ? nb : b)));
    onClose();
  };

  const del = () => { setBlocks(blocks.filter((b) => b.id !== state.id)); onClose(); };
  const weekOpts = WEEKS.map((w) => (
    <SelectItem key={w.num} value={String(w.num)}>№{w.num} · {w.label}</SelectItem>
  ));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">
            {admin ? (isNew ? "Новый блок ротации" : "Редактирование блока") : "Блок ротации"}
          </DialogTitle>
        </DialogHeader>

        {!admin ? (
          <div className="space-y-1 text-sm">
            <p className="font-medium">{residentById(state.residentId).fio}</p>
            <p>{u.name}</p>
            <p className="mono text-muted-foreground">{blockRangeLabel({ ...(state as any), id: "x" })}</p>
            <p className={state.curatorId ? "text-muted-foreground" : ""} style={state.curatorId ? undefined : { color: AMBER }}>
              {state.curatorId ? "Куратор: " + curatorById(state.curatorId)!.fio : "⚠️ куратор не назначен"}
            </p>
            <p className="pt-2 text-xs opacity-60">Для правки войдите в режим администратора (вкладка «Админка»).</p>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div>
              <label className="caps-label mb-1 block text-[10px] text-muted-foreground">Ординатор</label>
              <Select value={state.residentId} onValueChange={(v) => setState({ ...state, residentId: v })}>
                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>{RESIDENTS.map((r) => <SelectItem key={r.id} value={r.id}>{r.fio}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="caps-label mb-1 block text-[10px] text-muted-foreground">Подразделение</label>
              <Select value={state.unitId}
                onValueChange={(v) => setState({ ...state, unitId: v, curatorId: unitById(v).rule === "auto" ? unitById(v).candidates[0] : null })}>
                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>{UNITS.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="caps-label mb-1 block text-[10px] text-muted-foreground">С недели</label>
                <Select value={String(state.from)} onValueChange={(v) => setState({ ...state, from: +v })}>
                  <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>{weekOpts}</SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <label className="caps-label mb-1 block text-[10px] text-muted-foreground">По неделю</label>
                <Select value={String(state.to)} onValueChange={(v) => setState({ ...state, to: +v })}>
                  <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>{weekOpts}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="caps-label mb-1 block text-[10px] text-muted-foreground">
                Куратор {u.rule === "auto" && <span className="normal-case tracking-normal opacity-60">(назначается автоматически)</span>}
              </label>
              {u.rule === "auto" ? (
                <p className="border border-border bg-muted px-3 py-2">{curatorById(u.candidates[0])!.fio}</p>
              ) : (
                <Select value={state.curatorId ?? "none"}
                  onValueChange={(v) => setState({ ...state, curatorId: v === "none" ? null : v })}>
                  <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— не назначен —</SelectItem>
                    {u.candidates.map((cid) => {
                      const c = curatorById(cid)!;
                      return <SelectItem key={cid} value={cid}>{c.fio}{c.note ? ` — ${c.note}` : ""}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              )}
            </div>
            {msg && <p className="text-sm text-red-700">{msg}</p>}
          </div>
        )}

        {admin && (
          <DialogFooter className="gap-2">
            {!isNew && <Button variant="destructive" onClick={del}>Удалить</Button>}
            <Button variant="outline" onClick={onClose}>Отмена</Button>
            <Button onClick={save}>Сохранить</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ──────────────────────────────────── Приложение ──────────────────────────────────── */

const tabCls = "caps-label rounded-none border-b-2 border-transparent bg-transparent px-0 pb-2 pt-1 text-[11px] " +
  "data-[state=active]:border-current data-[state=active]:bg-transparent data-[state=active]:shadow-none";

export default function App() {
  const [blocks, setBlocks] = useState<Block[]>(INITIAL_BLOCKS);
  const [date, setDate] = useState("2025-12-12");
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);

  const openEditor = (b: Block | null) =>
    setEditor(b
      ? { id: b.id, residentId: b.residentId, unitId: b.unitId, from: b.from, to: b.to, curatorId: b.curatorId }
      : { id: null, residentId: RESIDENTS[0].id, unitId: UNITS[0].id, from: 1, to: 4, curatorId: UNITS[0].candidates[0] });

  const curW = useMemo(() => currentWeekNum(date), [date]);
  const week = curW ? weekByNum(curW) : null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b-2 bg-white" style={{ borderColor: INK }}>
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-5 py-3">
          <div className="flex items-center gap-4">
            <div className="border-2 px-3 py-1.5 text-center" style={{ borderColor: INK }}>
              <div className="caps-label text-[9px] text-muted-foreground">неделя</div>
              <div className="mono text-xl font-bold leading-none">{curW ?? "—"}</div>
              {week && <div className="mono mt-0.5 text-[9px] text-muted-foreground">{week.label}</div>}
            </div>
            <div>
              <div className="caps-label text-[10px]" style={{ color: PETROL }}>
                ММКЦ «Коммунарка» · Учебная часть
              </div>
              <h1 className="text-xl font-semibold leading-tight">Ротации ординаторов — 1 год, 2025/26</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="caps-label text-[10px] text-muted-foreground">Демо-дата «сегодня»</span>
            <input type="date" value={date} min="2025-08-25" max="2026-07-10"
              onChange={(e) => setDate(e.target.value)}
              className="mono border border-input bg-white px-2 py-1 text-sm" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-5 py-5">
        <Tabs defaultValue="curator">
          <TabsList className="mb-5 h-auto w-full justify-start gap-6 rounded-none border-b bg-transparent p-0">
            <TabsTrigger className={tabCls} value="curator">Кабинет куратора</TabsTrigger>
            <TabsTrigger className={tabCls} value="matrix">Матрица</TabsTrigger>
            <TabsTrigger className={tabCls} value="edu">Учебная часть{adminUnlocked && " 🔓"}</TabsTrigger>
            <TabsTrigger className={tabCls} value="admin">Админка{adminUnlocked && " 🔓"}</TabsTrigger>
          </TabsList>
          <TabsContent value="curator">
            <CuratorView blocks={blocks} date={date} />
          </TabsContent>
          <TabsContent value="matrix">
            <Matrix blocks={blocks} date={date} onCellClick={(b) => openEditor(b)} />
          </TabsContent>
          <TabsContent value="edu">
            <EduView blocks={blocks} date={date}
              unlocked={adminUnlocked} setUnlocked={setAdminUnlocked} />
          </TabsContent>
          <TabsContent value="admin">
            <AdminView blocks={blocks} setBlocks={setBlocks}
              unlocked={adminUnlocked} setUnlocked={setAdminUnlocked} openEditor={openEditor} />
          </TabsContent>
        </Tabs>
      </main>

      {editor && (
        <BlockDialog state={editor} setState={setEditor} admin={adminUnlocked}
          blocks={blocks} setBlocks={setBlocks} onClose={() => setEditor(null)} />
      )}
    </div>
  );
}
