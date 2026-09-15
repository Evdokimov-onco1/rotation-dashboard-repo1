import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  WEEKS, UNITS, RESIDENTS, ORGS, SETTINGS, type Block, type Resident, type User,
  unitById, curatorById, residentById, blockRangeLabel, shortFio, orgTitle,
} from "../data";
import { updateBlock, errText } from "../api";
import { blockStatus, currentWeekNum, unitLoad } from "../lib/calendar";
import { INK, RED, MUTE, RULE, canEditOrg } from "./common";

export interface MatrixFilter { orgId: string; year: string; }

const CW = 30;        // ширина недели, px
const NAME_W = 200;   // колонка фамилий, px
const EDGE = 7;       // зона захвата края блока, px
const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

interface Drag {
  id: string; mode: "move" | "left" | "right";
  origin: { residentId: string; from: number; to: number };
  grab: number;                   // смещение захвата от начала блока (для move)
  residentId: string; from: number; to: number;
  moved: boolean; conflict: Block | null;
  x: number; y: number;
  rowTop: number;                 // верх строки-цели относительно обёртки таблицы
}

export function Matrix({ blocks, date, user, onCellClick, onCreateAt, onBlockChanged, filter, setFilter }:
  {
    blocks: Block[]; date: string; user: User | null;
    onCellClick: (b: Block) => void;
    onCreateAt: (residentId: string, week: number) => void;
    onBlockChanged: (b: Block) => void;
    filter: MatrixFilter; setFilter: (f: MatrixFilter) => void;
  }) {
  const curW = currentWeekNum(date);
  const [showLoad, setShowLoad] = useState(true);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [headH, setHeadH] = useState(0);
  const tableRef = useRef<HTMLTableElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const movedRef = useRef(false);
  const lastWeek = WEEKS.at(-1)?.num ?? 35;
  const threshold = SETTINGS.capacityThreshold;

  useLayoutEffect(() => { setHeadH(theadRef.current?.getBoundingClientRect().height ?? 0); });

  const editable = (residentId: string) => {
    const r = residentById(residentId);
    return !!r && canEditOrg(user, r.orgId);
  };

  const visible = RESIDENTS.filter((r) => r.active
    && (filter.orgId === "all" || r.orgId === filter.orgId)
    && (filter.year === "all" || String(r.year) === filter.year));

  const groups: { key: string; title: string; residents: Resident[] }[] = [];
  for (const org of ORGS) {
    for (const y of [1, 2, 3]) {
      const rs = visible.filter((r) => r.orgId === org.id && r.year === y).sort((a, z) => a.fio.localeCompare(z.fio, "ru"));
      if (!rs.length) continue;
      const total = RESIDENTS.filter((r) => r.active && r.orgId === org.id && r.year === y).length;
      const who = y === 1 ? "Первый год" : y === 2 ? "Второй год" : "Третий год";
      const n = total === 1 ? "1 человек" : total < 5 ? `${total} человека` : `${total} человек`;
      groups.push({ key: `${org.id}-${y}`, title: `${who}, ${orgTitle(org)} — ${n}${y >= 2 ? ", закреплены за отделениями" : ""}`, residents: rs });
    }
  }

  /* ── загрузка с учётом перетаскивания (сама таблица рисует исходное положение, тянущийся блок — отдельный слой) ── */
  const load = unitLoad(drag
    ? blocks.map((b) => (b.id === drag.id ? { ...b, residentId: drag.residentId, from: drag.from, to: drag.to } : b))
    : blocks);

  /* ── геометрия ── */
  const weekAtX = (clientX: number): number => {
    const rect = tableRef.current!.getBoundingClientRect();
    const w = Math.floor((clientX - rect.left - NAME_W) / CW) + 1;
    return Math.max(1, Math.min(lastWeek, w));
  };
  const residentAtY = (clientX: number, clientY: number): string | null => {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const tr = el?.closest("tr[data-rid]") as HTMLElement | null;
    return tr?.dataset.rid ?? null;
  };
  const rowTopOf = (residentId: string): number => {
    const wrap = wrapRef.current?.getBoundingClientRect();
    const tr = wrapRef.current?.querySelector(`tr[data-rid="${residentId}"]`);
    if (!wrap || !tr) return 0;
    return tr.getBoundingClientRect().top - wrap.top;
  };
  const findConflict = (d: Pick<Drag, "id" | "residentId" | "from" | "to">) =>
    blocks.find((b) => b.id !== d.id && b.residentId === d.residentId && !(d.to < b.from || b.to < d.from)) ?? null;

  const startDrag = (e: React.PointerEvent<HTMLDivElement>, b: Block) => {
    if (e.button !== 0 || !editable(b.residentId)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mode: Drag["mode"] = e.clientX - rect.left < EDGE ? "left" : rect.right - e.clientX < EDGE ? "right" : "move";
    const d: Drag = {
      id: b.id, mode, origin: { residentId: b.residentId, from: b.from, to: b.to },
      grab: weekAtX(e.clientX) - b.from,
      residentId: b.residentId, from: b.from, to: b.to, moved: false, conflict: null, x: e.clientX, y: e.clientY,
      rowTop: rowTopOf(b.residentId),
    };
    dragRef.current = d; movedRef.current = false;
    setDrag(d);
    e.preventDefault();
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current; if (!d) return;
      const week = weekAtX(e.clientX);
      let { from, to, residentId } = d;
      if (d.mode === "move") {
        const len = d.origin.to - d.origin.from;
        from = Math.max(1, Math.min(lastWeek - len, week - d.grab)); to = from + len;
        const rid = residentAtY(e.clientX, e.clientY);
        if (rid && editable(rid)) residentId = rid;
      } else if (d.mode === "left") {
        from = Math.min(week, d.to);
      } else {
        to = Math.max(week, d.from);
      }
      const moved = d.moved || from !== d.origin.from || to !== d.origin.to || residentId !== d.origin.residentId;
      const next: Drag = { ...d, from, to, residentId, moved, x: e.clientX, y: e.clientY, conflict: null, rowTop: rowTopOf(residentId) };
      next.conflict = findConflict(next);
      dragRef.current = next; movedRef.current = moved;
      setDrag(next);
    };
    const finish = async (commit: boolean) => {
      const d = dragRef.current; dragRef.current = null; setDrag(null);
      if (!d || !commit || !d.moved) return;
      const changed = d.from !== d.origin.from || d.to !== d.origin.to || d.residentId !== d.origin.residentId;
      if (!changed) return;
      if (d.conflict) {
        const u = unitById(d.conflict.unitId);
        setNotice(`Не сохранено: пересекается с блоком ${u.short}, недели ${d.conflict.from}–${d.conflict.to}.`);
        return;
      }
      const b = blocks.find((x) => x.id === d.id); if (!b) return;
      const u = unitById(b.unitId);
      try {
        const r = await updateBlock(b.id, {
          residentId: d.residentId, unitId: b.unitId, from: d.from, to: d.to,
          curatorId: u.rule === "auto" ? (u.candidates[0] ?? null) : b.curatorId, comment: b.comment ?? null,
        });
        onBlockChanged(r.block);
        setNotice(null);
      } catch (err) {
        setNotice(errText(err));
      }
    };
    const onUp = () => { void finish(true); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") void finish(false); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null, blocks]);

  /* ── ячейки ── */
  const weekOn = (w: number) => WEEKS.find((x) => x.num === w)?.isRotation ?? true;
  const emptyCell = (rid: string, w: number) => (
    <td key={"e" + w} className={weekOn(w) ? "" : "hatch"} style={{ borderBottom: `1px solid ${RULE}` }}
      onDoubleClick={() => editable(rid) && onCreateAt(rid, w)} />
  );

  const rowFor = (r: Resident) => {
    const own = blocks.filter((b) => b.residentId === r.id).sort((a, z) => a.from - z.from);
    const cells: React.ReactNode[] = [];
    let w = 1;
    for (const bl of own) {
      for (; w < bl.from; w++) cells.push(emptyCell(r.id, w));
      const u = unitById(bl.unitId);
      const un = !bl.curatorId;
      const dragging = drag?.id === bl.id;
      const past = blockStatus(bl, date) === "past";
      const can = editable(bl.residentId);
      cells.push(
        <td key={bl.id} colSpan={bl.to - bl.from + 1} style={{ padding: "5px 0", borderBottom: `1px solid ${RULE}` }}>
          <div
            onPointerDown={(e) => startDrag(e, bl)}
            onClick={() => { if (!movedRef.current) onCellClick(bl); movedRef.current = false; }}
            title={`${u.name}, ${blockRangeLabel(bl)}${bl.curatorId ? "\nКуратор: " + curatorById(bl.curatorId)!.fio : "\nКуратор ещё не назначен"}${bl.comment ? "\n" + bl.comment : ""}${can ? "\nПеретащите, чтобы сдвинуть; потяните за край, чтобы изменить длину" : ""}`}
            className={"mx-[2px] flex h-[22px] select-none items-center justify-center rounded-[2px] text-[11px] font-medium leading-none " +
              (can ? "cursor-grab active:cursor-grabbing " : "cursor-pointer ")}
            style={{
              touchAction: "none",
              background: un ? "var(--paper)" : u.color,
              color: un ? u.color : "#fff",
              border: un ? `1.5px solid ${u.color}` : "1.5px solid transparent",
              opacity: dragging ? 0.3 : past ? 0.55 : 1,
              outline: dragging ? `1.5px dashed ${MUTE}` : undefined,
            }}
          >
            {u.short}
          </div>
        </td>
      );
      w = bl.to + 1;
    }
    for (; w <= lastWeek; w++) cells.push(emptyCell(r.id, w));
    return (
      <tr key={r.id} data-rid={r.id}>
        <th className="serif whitespace-nowrap pr-3 text-left text-[14px] font-normal"
          style={{ padding: "5px 12px 5px 0", borderBottom: `1px solid ${RULE}`, borderRight: `1px solid ${INK}` }}
          title={r.fio + (r.priority ? `, приоритет: ${r.priority}` : "")}>
          {shortFio(r.fio)}
          {r.mode === "fixed" && <span className="ml-1.5 font-sans text-[11px]" style={{ color: MUTE }}>закреплён на год</span>}
        </th>
        {cells}
      </tr>
    );
  };

  /* ── полосы месяцев ── */
  const monthCells: React.ReactNode[] = [];
  for (let i = 0; i < WEEKS.length;) {
    const m = +WEEKS[i].start.slice(5, 7); let j = i;
    while (j < WEEKS.length && +WEEKS[j].start.slice(5, 7) === m) j++;
    monthCells.push(
      <th key={i} colSpan={j - i} className="serif text-left text-[12px] font-normal italic"
        style={{ color: MUTE, padding: "0 0 2px 6px", borderLeft: `1px solid ${RULE}` }}>{MONTHS[m - 1]}</th>
    );
    i = j;
  }
  const headerCells = WEEKS.map((wk) => (
    <th key={wk.num} title={wk.label + (wk.isRotation ? "" : ", ротации нет") + (wk.note ? "\n" + wk.note : "")}
      className={"text-center text-[11px] " + (wk.isRotation ? "" : "hatch ")}
      style={{ width: CW, padding: "6px 0 8px", fontWeight: wk.num === curW ? 600 : 400, color: wk.num === curW ? RED : MUTE, borderBottom: `1px solid ${INK}` }}>
      {wk.num}
    </th>
  ));
  const unitsInUse = UNITS.filter((u) => load.has(u.id));
  const tableW = NAME_W + WEEKS.length * CW;
  const unassigned = blocks.filter((b) => !b.curatorId && residentById(b.residentId)?.active && blockStatus(b, date) !== "past").length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-[13px]">
        <Select value={filter.orgId} onValueChange={(v) => setFilter({ ...filter, orgId: v })}>
          <SelectTrigger className="h-8 w-[220px] border-0 border-b border-dotted bg-transparent px-0 shadow-none" style={{ borderColor: INK }}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все организации</SelectItem>
            {ORGS.map((o) => <SelectItem key={o.id} value={o.id}>{o.short}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filter.year} onValueChange={(v) => setFilter({ ...filter, year: v })}>
          <SelectTrigger className="h-8 w-[190px] border-0 border-b border-dotted bg-transparent px-0 shadow-none" style={{ borderColor: INK }}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Оба года обучения</SelectItem>
            {[1, 2, 3].map((y) => <SelectItem key={y} value={String(y)}>{y} год</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="ml-auto" style={{ color: MUTE }}>
          {RESIDENTS.filter((r) => r.active).length} ординаторов, {blocks.length} блоков.
          {unassigned > 0 && <> Без куратора <span style={{ color: RED, fontWeight: 500 }}>{unassigned}</span>.</>}
        </span>
        <label className="flex items-center gap-1.5 text-xs" style={{ color: MUTE }}>
          <input id="show-load" type="checkbox" checked={showLoad} onChange={(e) => setShowLoad(e.target.checked)} />
          загрузка
        </label>
      </div>

      {notice && <p className="mb-2 text-[13px]" style={{ color: RED }}>{notice}</p>}

      <div className="overflow-x-auto">
        <div ref={wrapRef} className="relative" style={{ width: tableW }}>
          <table ref={tableRef} className="border-collapse" style={{ width: tableW, tableLayout: "fixed" }}>
            <colgroup><col style={{ width: NAME_W }} />{WEEKS.map((w) => <col key={w.num} style={{ width: CW }} />)}</colgroup>
            <thead ref={theadRef}>
              <tr><th></th>{monthCells}</tr>
              <tr><th style={{ borderBottom: `1px solid ${INK}`, borderRight: `1px solid ${INK}` }}></th>{headerCells}</tr>
            </thead>
            <tbody>
              {groups.length === 0 && (
                <tr><td colSpan={lastWeek + 1} className="px-3 py-4 text-sm" style={{ color: MUTE }}>Нет ординаторов по выбранному фильтру.</td></tr>
              )}
              {groups.map((g) => (
                <GroupRows key={g.key} title={g.title} colSpan={lastWeek + 1}>{g.residents.map(rowFor)}</GroupRows>
              ))}
            </tbody>
          </table>
          {drag && drag.moved && (() => {
            const b = blocks.find((x) => x.id === drag.id); if (!b) return null;
            const u = unitById(b.unitId);
            return (
              <div className={"pointer-events-none absolute z-20 flex h-[22px] items-center justify-center rounded-[2px] text-[11px] font-medium leading-none text-white " + (drag.conflict ? "conflict" : "")}
                style={{ left: NAME_W + (drag.from - 1) * CW + 2, top: drag.rowTop + 5, width: (drag.to - drag.from + 1) * CW - 4, background: u.color, boxShadow: `0 0 0 2px ${INK}, 0 8px 18px rgba(31,41,51,.28)` }}>
                {u.short}
              </div>
            );
          })()}
          {curW !== null && (
            <div className="pointer-events-none absolute bottom-0"
              style={{ left: NAME_W + (curW - 1) * CW, top: headH - 30, width: CW, borderLeft: `1.5px solid ${RED}`, borderRight: `1.5px solid ${RED}`, background: "rgba(179,38,30,.04)" }} />
          )}
        </div>
      </div>

      {drag && drag.moved && (
        <div className="pointer-events-none fixed z-50 whitespace-nowrap rounded-[3px] px-2.5 py-1.5 text-[12px] text-white"
          style={{ left: drag.x + 14, top: drag.y + 18, background: drag.conflict ? RED : INK }}>
          {shortFio(residentById(drag.residentId).fio)}, недели {drag.from}–{drag.to}
          {drag.conflict && ` — пересекается с ${unitById(drag.conflict.unitId).short} (${drag.conflict.from}–${drag.conflict.to})`}
        </div>
      )}

      {showLoad && unitsInUse.length > 0 && (
        <div className="mt-5">
          <div className="mb-1.5 text-[13px]" style={{ color: MUTE }}>
            Сколько ординаторов одновременно в подразделении. Красным — больше {threshold === 1 ? "одного" : threshold === 2 ? "двух" : threshold === 3 ? "трёх" : threshold}.
          </div>
          <div className="overflow-x-auto">
            <table className="border-collapse" style={{ width: tableW, tableLayout: "fixed" }}>
              <colgroup><col style={{ width: NAME_W }} />{WEEKS.map((w) => <col key={w.num} style={{ width: CW }} />)}</colgroup>
              <tbody>
                {unitsInUse.map((u) => {
                  const row = load.get(u.id)!;
                  return (
                    <tr key={u.id}>
                      <th className="whitespace-nowrap text-left text-[12px] font-normal"
                        style={{ padding: "3px 12px 3px 0", borderBottom: `1px solid ${RULE}`, borderRight: `1px solid ${INK}` }}>
                        <span className="mr-2 inline-block h-[9px] w-[9px] rounded-[2px] align-[-1px]" style={{ background: u.color }} />{u.short}
                      </th>
                      {WEEKS.map((wk) => {
                        const c = row.get(wk.num) ?? 0;
                        const over = c > threshold;
                        return (
                          <td key={wk.num} className="text-center text-[11px]"
                            style={{ padding: "3px 0", borderBottom: `1px solid ${RULE}`, color: over ? RED : c === 0 ? RULE : INK, fontWeight: over ? 600 : 400 }}>
                            {c || "–"}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5">
        {unitsInUse.map((u) => (
          <span key={u.id} className="flex items-center gap-1.5 text-[12px]">
            <span className="h-[10px] w-[10px] rounded-[2px]" style={{ background: u.color }} /> {u.short}, {u.name}
          </span>
        ))}
      </div>
      <p className="mt-3 text-[12px]" style={{ color: MUTE }}>
        Закрашенный блок — куратор назначен, контурный — ещё нет. Красная полоса — текущая неделя, штриховка — неделя без ротации.
        {user ? " Перетащите блок, чтобы сдвинуть его или передать другому ординатору; потяните за край, чтобы изменить длину; двойной клик по пустой клетке — новый блок. Изменения сохраняются сразу." : " Нажмите на блок, чтобы открыть карточку."}
      </p>
    </div>
  );
}

function GroupRows({ title, colSpan, children }: { title: string; colSpan: number; children: React.ReactNode }) {
  return (
    <>
      <tr>
        <td colSpan={colSpan} className="serif text-[13px] italic" style={{ padding: "14px 0 4px", borderBottom: `1px solid ${INK}` }}>{title}</td>
      </tr>
      {children}
    </>
  );
}
