import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  WEEKS, UNITS, RESIDENTS, ORGS, SETTINGS, type Block, type Resident,
  unitById, curatorById, blockRangeLabel, shortFio,
} from "../data";
import { blockStatus, currentWeekNum, unitLoad } from "../lib/calendar";
import { INK, PETROL, AMBER } from "./common";

const HATCH = "repeating-linear-gradient(135deg, transparent 0 3px, rgba(0,0,0,0.06) 3px 4px)";

export interface MatrixFilter { orgId: string; year: string; }

export function Matrix({ blocks, date, onCellClick, filter, setFilter }:
  {
    blocks: Block[]; date: string; onCellClick: (b: Block) => void;
    filter: MatrixFilter; setFilter: (f: MatrixFilter) => void;
  }) {
  const curW = currentWeekNum(date);
  const [showLoad, setShowLoad] = useState(true);
  const lastWeek = WEEKS.at(-1)?.num ?? 35;

  const visible = RESIDENTS.filter((r) => r.active
    && (filter.orgId === "all" || r.orgId === filter.orgId)
    && (filter.year === "all" || String(r.year) === filter.year));

  // группы: организация × год обучения
  const groups: { key: string; title: string; residents: Resident[] }[] = [];
  for (const org of ORGS) {
    for (const y of [1, 2, 3]) {
      const rs = visible.filter((r) => r.orgId === org.id && r.year === y).sort((a, z) => a.fio.localeCompare(z.fio, "ru"));
      if (rs.length) groups.push({ key: `${org.id}-${y}`, title: `${org.short} · ${y} год`, residents: rs });
    }
  }

  const load = unitLoad(blocks); // без useMemo: зависит и от RESIDENTS (активность), которые правятся на месте
  const threshold = SETTINGS.capacityThreshold;

  const emptyCell = (w: number) => (
    <td key={"e" + w} className="border border-border bg-muted/60"
      style={!weekOn(w) ? { backgroundImage: HATCH } : undefined} />
  );
  const weekOn = (w: number) => WEEKS.find((x) => x.num === w)?.isRotation ?? true;

  const rowFor = (r: Resident) => {
    const own = blocks.filter((b) => b.residentId === r.id).sort((a, z) => a.from - z.from);
    const cells: React.ReactNode[] = [];
    let w = 1;
    for (const bl of own) {
      for (; w < bl.from; w++) cells.push(emptyCell(w));
      const u = unitById(bl.unitId);
      const isCur = curW !== null && bl.from <= curW && curW <= bl.to;
      cells.push(
        <td
          key={bl.id}
          colSpan={bl.to - bl.from + 1}
          onClick={() => onCellClick(bl)}
          title={`${u.name}, ${blockRangeLabel(bl)}${bl.curatorId ? "\nКуратор: " + curatorById(bl.curatorId)!.fio : "\n⚠️ куратор не назначен"}${bl.comment ? "\n" + bl.comment : ""}`}
          className={"cursor-pointer border px-1 py-1.5 text-center text-[11px] font-medium leading-tight text-white select-none " +
            (isCur ? "ring-2 ring-inset " : "") +
            (!bl.curatorId ? "border-dashed border-amber-600" : "border-white/40")}
          style={{
            background: u.color,
            opacity: blockStatus(bl, date) === "past" ? 0.5 : 1,
            ...(isCur ? { ["--tw-ring-color" as string]: INK } : {}),
          }}
        >
          {u.short}{!bl.curatorId && " ⚠️"}
        </td>
      );
      w = bl.to + 1;
    }
    for (; w <= lastWeek; w++) cells.push(emptyCell(w));
    return (
      <tr key={r.id}>
        <th className="sticky left-0 z-10 border border-border bg-white px-2 py-1 text-left text-xs font-medium whitespace-nowrap"
          title={r.fio + (r.priority ? ` · приоритет: ${r.priority}` : "") + (r.mode === "fixed" ? " · закреплён за отделением" : "")}>
          {shortFio(r.fio)}{r.mode === "fixed" && <span className="ml-1 text-[10px] text-muted-foreground">📌</span>}
        </th>
        {cells}
      </tr>
    );
  };

  const headerCells = WEEKS.map((wk) => (
    <th key={wk.num} title={wk.label + (wk.isRotation ? "" : " · нет ротации") + (wk.note ? "\n" + wk.note : "")}
      className="mono border border-border px-0.5 py-1 text-center text-[10px] font-normal"
      style={wk.num === curW
        ? { background: PETROL, color: "#fff" }
        : { background: "hsl(160 10% 93%)", color: "#5b6b70", ...(wk.isRotation ? {} : { backgroundImage: HATCH }) }}>
      {wk.num}
    </th>
  ));

  const unitsInUse = UNITS.filter((u) => load.has(u.id));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="caps-label text-[11px] text-muted-foreground">Показать</span>
        <Select value={filter.orgId} onValueChange={(v) => setFilter({ ...filter, orgId: v })}>
          <SelectTrigger className="w-[220px] bg-white"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все организации</SelectItem>
            {ORGS.map((o) => <SelectItem key={o.id} value={o.id}>{o.short}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filter.year} onValueChange={(v) => setFilter({ ...filter, year: v })}>
          <SelectTrigger className="w-[160px] bg-white"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все годы обучения</SelectItem>
            {[1, 2, 3].map((y) => <SelectItem key={y} value={String(y)}>{y} год</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <input id="show-load" type="checkbox" checked={showLoad} onChange={(e) => setShowLoad(e.target.checked)} />
          загрузка подразделений
        </label>
      </div>

      <div className="overflow-x-auto border border-border bg-white">
        <table className="border-collapse" style={{ minWidth: 1180 }}>
          <thead>
            <tr>
              <th className="caps-label sticky left-0 z-10 border border-border bg-white px-2 py-1 text-left text-[10px] font-normal text-muted-foreground">
                Ординатор · неделя
              </th>
              {headerCells}
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr><td colSpan={lastWeek + 1} className="px-3 py-4 text-sm text-muted-foreground">Нет ординаторов по выбранному фильтру.</td></tr>
            )}
            {groups.map((g) => (
              <GroupRows key={g.key} title={g.title} count={g.residents.length} colSpan={lastWeek + 1}>
                {g.residents.map(rowFor)}
              </GroupRows>
            ))}
          </tbody>
        </table>
      </div>

      {showLoad && unitsInUse.length > 0 && (
        <div className="mt-4">
          <div className="caps-label mb-1 text-[11px] text-muted-foreground">
            Загрузка подразделений, чел. в неделю · порог {threshold} · выше порога — жёлтым
          </div>
          <div className="overflow-x-auto border border-border bg-white">
            <table className="border-collapse" style={{ minWidth: 1180 }}>
              <thead>
                <tr>
                  <th className="caps-label sticky left-0 z-10 border border-border bg-white px-2 py-1 text-left text-[10px] font-normal text-muted-foreground">Подразделение</th>
                  {headerCells}
                </tr>
              </thead>
              <tbody>
                {unitsInUse.map((u) => {
                  const row = load.get(u.id)!;
                  return (
                    <tr key={u.id}>
                      <th className="sticky left-0 z-10 border border-border bg-white px-2 py-0.5 text-left text-xs font-medium whitespace-nowrap">
                        <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[2px] align-middle" style={{ background: u.color }} />{u.short}
                      </th>
                      {WEEKS.map((wk) => {
                        const c = row.get(wk.num) ?? 0;
                        const over = c > threshold;
                        return (
                          <td key={wk.num} className="mono border border-border px-0.5 py-0.5 text-center text-[10px]"
                            style={over ? { background: "#fde68a", color: AMBER, fontWeight: 600 }
                              : c === 0 ? { color: "#c4ccd0" } : undefined}>
                            {c || "·"}
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

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {unitsInUse.map((u) => (
          <span key={u.id} className="flex items-center gap-1.5 text-xs text-neutral-700">
            <span className="h-3 w-3 rounded-[2px]" style={{ background: u.color }} /> {u.short} — {u.name}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Пунктир и ⚠️ — куратор не назначен · тёмная рамка — текущая неделя · блеклые блоки завершились ·
        штриховка — неделя без ротации · 📌 — закреплён за отделением на год ·
        клик по блоку — карточка (после входа — редактирование).
      </p>
    </div>
  );
}

function GroupRows({ title, count, colSpan, children }: { title: string; count: number; colSpan: number; children: React.ReactNode }) {
  return (
    <>
      <tr>
        <td colSpan={colSpan} className="caps-label sticky left-0 border border-border px-2 py-1 text-[10px]"
          style={{ background: "hsl(160 10% 96%)", color: PETROL }}>
          {title} · {count}
        </td>
      </tr>
      {children}
    </>
  );
}
