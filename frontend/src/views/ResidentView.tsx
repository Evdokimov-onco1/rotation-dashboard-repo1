import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RESIDENTS, WEEKS, type Block, unitById, residentById, orgById, curatorById, yearLabel, shortFio } from "../data";
import { blockStatus, blockEnd, blockStart, currentWeekNum, diffDays, isComingSoon } from "../lib/calendar";
import { INK, RED, MUTE, RULE, fmtLong, weekdayIn } from "./common";

function curatorLine(b: Block): { text: string; missing: boolean } {
  if (!b.curatorId) return { text: "Куратор ещё не назначен, уточните в учебной части.", missing: true };
  const c = curatorById(b.curatorId)!;
  return { text: `Куратор: ${c.fio}${c.note ? `, ${c.note}` : ""}`, missing: false };
}

export function ResidentView({ blocks, date, initialId, onSelect }:
  { blocks: Block[]; date: string; initialId?: string | null; onSelect?: (id: string) => void }) {
  const active = RESIDENTS.filter((r) => r.active).sort((a, z) => a.fio.localeCompare(z.fio, "ru"));
  const [residentId, setResidentId] = useState<string>(initialId && active.some((r) => r.id === initialId) ? initialId : (active[0]?.id ?? ""));
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (initialId && active.some((r) => r.id === initialId)) setResidentId(initialId); }, [initialId]);

  const r = residentById(residentId);
  if (!r) return <p className="text-sm" style={{ color: MUTE }}>Ординаторов в этом году нет.</p>;
  const org = orgById(r.orgId);
  const own = blocks.filter((b) => b.residentId === residentId).sort((a, z) => a.from - z.from);
  const current = own.find((b) => blockStatus(b, date) === "current") ?? null;
  const future = own.filter((b) => blockStatus(b, date) === "future");
  const next = future[0] ?? null;
  const done = own.filter((b) => blockStatus(b, date) === "past").length;
  const curW = currentWeekNum(date);
  const lastWeek = WEEKS.at(-1)?.num ?? 35;
  const weeksLeft = curW ? Math.max(0, lastWeek - curW) : lastWeek;
  const link = `${location.origin}${location.pathname}#r=${residentId}`;

  const pick = (id: string) => { setResidentId(id); onSelect?.(id); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* буфер недоступен */ }
  };

  const plural = (n: number, one: string, few: string, many: string) =>
    n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;

  return (
    <div className="flex flex-wrap gap-x-12 gap-y-6">
      <div className="w-full max-w-[760px]">
        <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
          <span className="text-[13px]" style={{ color: MUTE }}>Я ординатор</span>
          <Select value={residentId} onValueChange={pick}>
            <SelectTrigger className="serif h-auto w-auto max-w-full border-0 border-b border-dotted bg-transparent px-0 py-0.5 text-[20px] shadow-none" style={{ borderColor: INK }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {active.map((x) => <SelectItem key={x.id} value={x.id}>{x.fio}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-[13px]" style={{ color: MUTE }}>
            {org?.short}, {r.year} год{r.priority ? `, приоритет из анкеты: ${r.priority}` : ""}
          </span>
        </div>

        <h2 className="serif mt-6 text-[22px] font-semibold">Ваш план на {yearLabel()}</h2>
        <p className="mb-1.5 text-[13px]" style={{ color: MUTE }}>
          {own.length === 0
            ? "Ротации ещё не запланированы."
            : r.mode === "fixed"
              ? "Вы закреплены за отделением на весь год."
              : `${own.length} ${plural(own.length, "блок", "блока", "блоков")}, ${done === 0 ? "ни один ещё не пройден" : `${done} ${plural(done, "пройден", "пройдено", "пройдено")}`}${current ? `, сейчас ${unitById(current.unitId).short} до ${fmtLong(blockEnd(current))}` : ""}${next ? `, дальше ${unitById(next.unitId).short} с ${fmtLong(blockStart(next))}` : ""}.`}
        </p>

        {own.map((b, i) => {
          const u = unitById(b.unitId);
          const st = blockStatus(b, date);
          const start = blockStart(b), end = blockEnd(b);
          const cl = curatorLine(b);
          const soon = st === "future" && isComingSoon(b, date);
          const dd = st === "future" ? diffDays(date, start) : 0;
          return (
            <div key={b.id} className="flex gap-3.5 py-3" style={{ borderBottom: `1px solid ${RULE}`, opacity: st === "past" ? 0.6 : 1 }}>
              <div className="w-1 flex-none rounded-[2px]" style={{ background: u.color }} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2.5">
                  <span className="text-[12px]" style={{ color: MUTE }}>{i + 1}</span>
                  <span className="serif text-[16px]">{u.name}</span>
                  {u.territory && <span className="text-[12px]" style={{ color: MUTE }}>{u.territory}</span>}
                  {st === "current" && <span className="ml-auto text-[12px] font-medium" style={{ color: RED }}>сейчас, до {fmtLong(end)}</span>}
                  {st === "future" && <span className="ml-auto text-[12px]" style={{ color: soon ? RED : MUTE, fontWeight: soon ? 500 : 400 }}>{soon ? `${weekdayIn(start)}, ${fmtLong(start)}` : dd <= 21 ? `через ${dd} ${plural(dd, "день", "дня", "дней")}` : `с ${fmtLong(start)}`}</span>}
                  {st === "past" && <span className="ml-auto text-[12px]" style={{ color: MUTE }}>завершена {fmtLong(end)}</span>}
                </div>
                <div className="mt-0.5 text-[13px]" style={{ color: MUTE }}>
                  {r.mode === "fixed" ? "весь год" : `недели ${b.from}–${b.to}`}, {fmtLong(start)} — {fmtLong(end)}
                </div>
                <div className="mt-0.5 text-[13px]" style={{ color: cl.missing ? RED : INK }}>{cl.text}</div>
                {st === "current" && (
                  <div className="mt-1 text-[13px]" style={{ color: MUTE }}>
                    Логбук подписывается у куратора за каждый день посещения. В последние два дня попросите доподписать все дни.
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex w-full max-w-[520px] flex-1 flex-col gap-4">
        {own.length > 0 && (
          <div className="bg-white p-4" style={{ border: `1px solid ${RULE}` }}>
            <div className="serif text-[16px] font-semibold">Ваш год по неделям</div>
            <div className="mt-3 flex h-6 gap-[2px]">
              {WEEKS.map((w) => {
                const b = own.find((x) => x.from <= w.num && w.num <= x.to);
                const col = b ? unitById(b.unitId).color : RULE;
                return <div key={w.num} title={`неделя ${w.num}, ${w.label}${b ? `: ${unitById(b.unitId).short}` : ""}`} className="flex-1 rounded-[1px]"
                  style={{ background: col, opacity: b && blockStatus(b, date) === "past" ? 0.5 : 1, outline: w.num === curW ? `2px solid ${RED}` : undefined, outlineOffset: 1 }} />;
              })}
            </div>
            <div className="mt-1.5 flex justify-between text-[11px]" style={{ color: MUTE }}>
              <span>{fmtLong(WEEKS[0].start).split(" ")[1]}</span><span>{fmtLong(WEEKS[Math.floor(WEEKS.length / 2)].start).split(" ")[1]}</span><span>{fmtLong(WEEKS.at(-1)!.end).split(" ")[1]}</span>
            </div>
            <div className="mt-3 flex gap-7">
              <div><div className="text-[30px] font-semibold leading-none">{done}</div><div className="mt-1 text-[12px]" style={{ color: MUTE }}>из {own.length} {plural(own.length, "блока", "блоков", "блоков")} пройдено</div></div>
              <div><div className="text-[30px] font-semibold leading-none">{weeksLeft}</div><div className="mt-1 text-[12px]" style={{ color: MUTE }}>{plural(weeksLeft, "неделя", "недели", "недель")} до конца года</div></div>
            </div>
          </div>
        )}
        {current && (
          <div className="bg-white p-4" style={{ border: `1px solid ${RULE}` }}>
            <div className="serif text-[16px] font-semibold">Сейчас</div>
            <div className="mt-2 text-[14px]">{unitById(current.unitId).name}</div>
            <div className="text-[13px]" style={{ color: MUTE }}>{curatorLine(current).text}</div>
            {next && (
              <>
                <div className="serif mt-4 text-[16px] font-semibold">Дальше</div>
                <div className="mt-2 text-[14px]">{unitById(next.unitId).name}, с {fmtLong(blockStart(next))}</div>
                <div className="text-[13px]" style={{ color: curatorLine(next).missing ? RED : MUTE }}>{curatorLine(next).text}</div>
              </>
            )}
          </div>
        )}
        <div className="text-[12px] leading-relaxed" style={{ color: MUTE }}>
          <div>Ссылка на ваш кабинет, чтобы сохранить в закладки:</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="break-all" style={{ color: INK }}>{link}</span>
            <Button variant="outline" size="sm" onClick={() => void copy()}>{copied ? "Скопировано" : "Скопировать"}</Button>
          </div>
          <div className="mt-2">Это {shortFio(r.fio)}? Если план выглядит неверно, напишите в учебную часть.</div>
        </div>
      </div>
    </div>
  );
}
