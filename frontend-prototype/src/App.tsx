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

/* ─────────────────────────── Карточка блока (строка списка) ─────────────────────────── */

function BlockRow({ bl, showResident = true, accent }: { bl: Block; showResident?: boolean; accent?: string }) {
  const u = unitById(bl.unitId);
  const cur = bl.curatorId ? curatorById(bl.curatorId) : null;
  return (
    <div className="flex items-start gap-3 py-2 border-b border-neutral-200 last:border-0">
      <span className="mt-1 h-3 w-3 shrink-0 rounded-sm" style={{ background: u.color }} />
      <div className="min-w-0">
        <div className="text-sm font-medium text-neutral-900">
          {showResident ? residentById(bl.residentId).fio : u.name}
          {accent && <Badge variant="outline" className="ml-2 align-middle">{accent}</Badge>}
        </div>
        <div className="text-sm text-neutral-600">
          {showResident && <span>{u.name} · </span>}
          {blockRangeLabel(bl)}
        </div>
        {!bl.curatorId && (
          <div className="text-sm text-amber-700">⚠️ куратор не назначен</div>
        )}
        {bl.curatorId && !showResident && cur && (
          <div className="text-sm text-neutral-500">куратор: {cur.fio}</div>
        )}
      </div>
    </div>
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
  const past = mine
    .filter((b) => blockStatus(b, date) === "past")
    .sort((a, z) => weekByNum(z.to).end.localeCompare(weekByNum(a.to).end));
  const future = mine
    .filter((b) => blockStatus(b, date) === "future")
    .sort((a, z) => weekByNum(a.from).start.localeCompare(weekByNum(z.from).start));

  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-sm text-neutral-600">Я — заведующий:</span>
        <Select value={curatorId} onValueChange={setCuratorId}>
          <SelectTrigger className="w-[420px] bg-white"><SelectValue /></SelectTrigger>
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
        <Card className="rounded-md border-l-4" style={{ borderLeftColor: "#2f6f4f" }}>
          <CardHeader className="pb-2"><CardTitle className="text-base">Сейчас у вас на ротации</CardTitle></CardHeader>
          <CardContent>
            {current.length === 0 && <p className="text-sm text-neutral-500">Сейчас никого нет.</p>}
            {current.map((b) => <BlockRow key={b.id} bl={b} accent={`до ${fmtD(weekByNum(b.to).end)}`} />)}
          </CardContent>
        </Card>

        <Card className="rounded-md border-l-4" style={{ borderLeftColor: "#b3541e" }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Завершили ротацию — подписать логбук</CardTitle>
          </CardHeader>
          <CardContent>
            {past.length === 0 && <p className="text-sm text-neutral-500">Завершённых ротаций пока нет.</p>}
            {past.map((b) => <BlockRow key={b.id} bl={b} />)}
          </CardContent>
        </Card>

        <Card className="rounded-md">
          <CardHeader className="pb-2"><CardTitle className="text-base">Придут следующими</CardTitle></CardHeader>
          <CardContent>
            {future.length === 0 && <p className="text-sm text-neutral-500">Запланированных ротаций нет.</p>}
            {future.slice(0, 4).map((b) => <BlockRow key={b.id} bl={b} accent={`с ${fmtD(weekByNum(b.from).start)}`} />)}
          </CardContent>
        </Card>

        {maybe.length > 0 && (
          <Card className="rounded-md border-amber-300 bg-amber-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Возможно, ваши (куратор ещё не назначен)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-1 text-sm text-neutral-600">
                Эти ротации проходят в подразделении, где вы — один из возможных кураторов.
                Назначение делает администратор.
              </p>
              {maybe.map((b) => <BlockRow key={b.id} bl={b} />)}
            </CardContent>
          </Card>
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
      for (; w < bl.from; w++) cells.push(<td key={"e" + w} className="border border-neutral-200 bg-neutral-50" />);
      const u = unitById(bl.unitId);
      const isCur = curW !== null && bl.from <= curW && curW <= bl.to;
      cells.push(
        <td
          key={bl.id}
          colSpan={bl.to - bl.from + 1}
          onClick={() => onCellClick(bl)}
          title={`${u.name}, ${blockRangeLabel(bl)}${bl.curatorId ? "\nКуратор: " + curatorById(bl.curatorId)!.fio : "\n⚠️ куратор не назначен"}`}
          className={"cursor-pointer border px-1 py-1.5 text-center text-[11px] font-medium leading-tight text-white select-none " +
            (isCur ? "ring-2 ring-inset ring-neutral-900 " : "") +
            (!bl.curatorId ? "border-dashed border-amber-600" : "border-white/40")}
          style={{ background: u.color, opacity: blockStatus(bl, date) === "past" ? 0.55 : 1 }}
        >
          {u.short}{!bl.curatorId && " ⚠️"}
        </td>
      );
      w = bl.to + 1;
    }
    for (; w <= 35; w++) cells.push(<td key={"e" + w} className="border border-neutral-200 bg-neutral-50" />);
    return (
      <tr key={r.id}>
        <th className="sticky left-0 z-10 border border-neutral-200 bg-white px-2 py-1 text-left text-xs font-medium whitespace-nowrap">
          {shortFio(r.fio)}
        </th>
        {cells}
      </tr>
    );
  });

  return (
    <div>
      <div className="overflow-x-auto rounded-md border border-neutral-300 bg-white">
        <table className="border-collapse" style={{ minWidth: 1180 }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border border-neutral-200 bg-white px-2 py-1 text-left text-xs text-neutral-500">
                Ординатор \ неделя
              </th>
              {WEEKS.map((wk) => (
                <th key={wk.num} title={wk.label}
                  className={"border border-neutral-200 px-0.5 py-1 text-center text-[10px] font-normal " +
                    (wk.num === curW ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600")}>
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
            <span className="h-3 w-3 rounded-sm" style={{ background: u.color }} /> {u.short} — {u.name}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        Пунктирная рамка и ⚠️ — куратор блока не назначен. Тёмная рамка — текущая неделя. Блеклые блоки — уже завершились.
        Наведите курсор для деталей, клик — карточка блока{" "}(в режиме администратора — редактирование).
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
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);

  if (!unlocked) {
    return (
      <Card className="max-w-sm rounded-md">
        <CardHeader><CardTitle className="text-base">Режим администратора</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-neutral-600">
            Просмотр открыт всем. Для редактирования графика введите PIN-код.
            <br /><span className="text-neutral-400">(в прототипе: 1234)</span>
          </p>
          <div className="flex gap-2">
            <Input type="password" inputMode="numeric" placeholder="PIN" value={pin}
              onChange={(e) => { setPin(e.target.value); setErr(false); }}
              onKeyDown={(e) => e.key === "Enter" && (pin === "1234" ? setUnlocked(true) : setErr(true))}
              className="w-32" />
            <Button onClick={() => (pin === "1234" ? setUnlocked(true) : setErr(true))}>Войти</Button>
          </div>
          {err && <p className="text-sm text-red-600">Неверный PIN.</p>}
        </CardContent>
      </Card>
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
        <p className="text-sm text-neutral-600">
          Редактирование включено. Любой блок в «Матрице» теперь открывается на правку по клику.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => openEditor(null)}>+ Добавить блок</Button>
          <Button variant="ghost" onClick={() => setUnlocked(false)}>Выйти</Button>
        </div>
      </div>

      <Card className="rounded-md border-amber-300">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Требуют назначения куратора {unassigned.length > 0 && <Badge className="ml-1 bg-amber-600">{unassigned.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {unassigned.length === 0 && <p className="text-sm text-neutral-500">Все блоки распределены. 🎉</p>}
          {unassigned.map((b) => {
            const u = unitById(b.unitId);
            return (
              <div key={b.id} className="flex flex-wrap items-center gap-3 border-b border-neutral-200 py-2 last:border-0">
                <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: u.color }} />
                <div className="min-w-[260px] flex-1">
                  <div className="text-sm font-medium">{residentById(b.residentId).fio}</div>
                  <div className="text-xs text-neutral-600">{u.name} · {blockRangeLabel(b)}</div>
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
        </CardContent>
      </Card>

      <p className="text-xs text-neutral-500">
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
      <DialogContent className="max-w-lg rounded-md">
        <DialogHeader>
          <DialogTitle className="text-base">
            {admin ? (isNew ? "Новый блок ротации" : "Редактирование блока") : "Блок ротации"}
          </DialogTitle>
        </DialogHeader>

        {!admin ? (
          <div className="space-y-1 text-sm">
            <p className="font-medium">{residentById(state.residentId).fio}</p>
            <p>{u.name}</p>
            <p className="text-neutral-600">{blockRangeLabel({ ...(state as any), id: "x" })}</p>
            <p className={state.curatorId ? "text-neutral-600" : "text-amber-700"}>
              {state.curatorId ? "Куратор: " + curatorById(state.curatorId)!.fio : "⚠️ куратор не назначен"}
            </p>
            <p className="pt-2 text-xs text-neutral-400">Для правки войдите в режим администратора (вкладка «Админка»).</p>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Ординатор</label>
              <Select value={state.residentId} onValueChange={(v) => setState({ ...state, residentId: v })}>
                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>{RESIDENTS.map((r) => <SelectItem key={r.id} value={r.id}>{r.fio}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Подразделение</label>
              <Select value={state.unitId}
                onValueChange={(v) => setState({ ...state, unitId: v, curatorId: unitById(v).rule === "auto" ? unitById(v).candidates[0] : null })}>
                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>{UNITS.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="mb-1 block text-xs text-neutral-500">С недели</label>
                <Select value={String(state.from)} onValueChange={(v) => setState({ ...state, from: +v })}>
                  <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>{weekOpts}</SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs text-neutral-500">По неделю</label>
                <Select value={String(state.to)} onValueChange={(v) => setState({ ...state, to: +v })}>
                  <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>{weekOpts}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500">
                Куратор {u.rule === "auto" && <span className="text-neutral-400">(назначается автоматически)</span>}
              </label>
              {u.rule === "auto" ? (
                <p className="rounded-sm border border-neutral-200 bg-neutral-50 px-3 py-2">{curatorById(u.candidates[0])!.fio}</p>
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
            {msg && <p className="text-sm text-red-600">{msg}</p>}
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

export default function App() {
  const [blocks, setBlocks] = useState<Block[]>(INITIAL_BLOCKS);
  const [date, setDate] = useState("2025-12-03");
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);

  const openEditor = (b: Block | null) =>
    setEditor(b
      ? { id: b.id, residentId: b.residentId, unitId: b.unitId, from: b.from, to: b.to, curatorId: b.curatorId }
      : { id: null, residentId: RESIDENTS[0].id, unitId: UNITS[0].id, from: 1, to: 4, curatorId: UNITS[0].candidates[0] });

  const curW = useMemo(() => currentWeekNum(date), [date]);

  return (
    <div className="min-h-screen bg-[#f4f5f2] text-neutral-900">
      <header className="border-b border-neutral-800 bg-[#1f2a37] px-5 py-3 text-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold leading-tight">Ротации ординаторов · 1 год · 2025/26</h1>
            <p className="text-xs text-neutral-300">ММКЦ «Коммунарка» — дашборд кураторов · ПРОТОТИП</p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-neutral-300">Демо-дата «сегодня»:</span>
            <input type="date" value={date} min="2025-08-25" max="2026-07-10"
              onChange={(e) => setDate(e.target.value)}
              className="rounded-sm border border-neutral-500 bg-[#2b3648] px-2 py-1 text-white" />
            <span className="text-neutral-300">
              {curW ? `неделя №${curW}` : "вне учебных недель"}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-5 py-5">
        <Tabs defaultValue="curator">
          <TabsList className="mb-4 rounded-md">
            <TabsTrigger value="curator">Кабинет куратора</TabsTrigger>
            <TabsTrigger value="matrix">Матрица</TabsTrigger>
            <TabsTrigger value="admin">Админка{adminUnlocked && " 🔓"}</TabsTrigger>
          </TabsList>
          <TabsContent value="curator">
            <CuratorView blocks={blocks} date={date} />
          </TabsContent>
          <TabsContent value="matrix">
            <Matrix blocks={blocks} date={date} onCellClick={(b) => openEditor(b)} />
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
