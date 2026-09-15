import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CURATORS, WEEKS, SETTINGS, type Block, unitById, residentById, orgById, curatorById } from "../data";
import { blockStatus, blockEnd, blockStart, diffDays, isComingSoon, isFinishing, nextBlockFor } from "../lib/calendar";
import { INK, RED, MUTE, RULE, fmtLong, weekdayIn } from "./common";

function Entry({ b, blocks, date, kind }: { b: Block; blocks: Block[]; date: string; kind: "current" | "future" | "past" | "maybe" }) {
  const r = residentById(b.residentId);
  const u = unitById(b.unitId);
  const org = orgById(r.orgId);
  const fin = kind === "current" && isFinishing(b, date);
  const soon = kind === "future" && isComingSoon(b, date);
  const start = blockStart(b), end = blockEnd(b);
  const nb = kind === "current" ? nextBlockFor(blocks, b.residentId, b.to) : null;
  const nextText = nb
    ? `${unitById(nb.unitId).name}, ${nb.curatorId ? curatorById(nb.curatorId)!.fio.split(" ").map((p, i) => (i === 0 ? p : p[0] + ".")).join(" ") : "куратор ещё не назначен"}, с ${fmtLong(blockStart(nb))}`
    : "ротации по графику завершены";
  const span = r.mode === "fixed" ? `весь год, ${fmtLong(start)} — ${fmtLong(end)}` : `недели ${b.from}–${b.to}, ${fmtLong(start)} — ${fmtLong(end)}`;
  return (
    <div className="flex gap-3.5 py-3" style={{ borderBottom: `1px solid ${RULE}` }}>
      <div className="w-1 flex-none rounded-[2px]" style={{ background: u.color, opacity: kind === "past" ? 0.5 : 1 }} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5">
          <span className="serif text-[16px]">{r.fio}</span>
          <span className="text-[12px]" style={{ color: MUTE }}>{org?.short}, {r.year} год</span>
          {soon && <span className="ml-auto text-[12px] font-medium" style={{ color: RED }}>{weekdayIn(start)}, {fmtLong(start)}</span>}
          {kind === "future" && !soon && <span className="ml-auto text-[12px]" style={{ color: MUTE }}>с {fmtLong(start)}</span>}
        </div>
        <div className="mt-0.5 text-[13px]" style={{ color: MUTE }}>{u.name}, {span}</div>
        {fin && <div className="mt-1 text-[13px]" style={{ color: RED }}>До {weekdayIn(end).replace(/^во? /, "")}, {fmtLong(end)}. Дальше: {nextText}</div>}
        {kind === "maybe" && <div className="mt-1 text-[13px]" style={{ color: RED }}>Куратор ещё не назначен. Возможно, это ваш ординатор.</div>}
        {r.mode === "fixed" && kind !== "maybe" && <div className="mt-1 text-[12px]" style={{ color: MUTE }}>Закреплён за отделением на второй год.</div>}
      </div>
    </div>
  );
}

export function CuratorView({ blocks, date, initialId, onSelect }:
  { blocks: Block[]; date: string; initialId?: string | null; onSelect?: (id: string) => void }) {
  const [curatorId, setCuratorId] = useState<string>(initialId && CURATORS.some((c) => c.id === initialId) ? initialId : (CURATORS[0]?.id ?? ""));
  const pick = (id: string) => { setCuratorId(id); onSelect?.(id); };
  const cur = curatorById(curatorId);
  const alive = blocks.filter((b) => residentById(b.residentId)?.active);
  const mine = alive.filter((b) => b.curatorId === curatorId);
  const maybe = alive.filter((b) => !b.curatorId && unitById(b.unitId).candidates.includes(curatorId) && blockStatus(b, date) !== "past");
  const current = mine.filter((b) => blockStatus(b, date) === "current");
  const finishing = current.filter((b) => isFinishing(b, date));
  const future = mine.filter((b) => blockStatus(b, date) === "future").sort((a, z) => blockStart(a).localeCompare(blockStart(z)));
  const soonN = future.filter((b) => isComingSoon(b, date)).length;
  const recent = mine.filter((b) => blockStatus(b, date) === "past" && diffDays(blockEnd(b), date) <= 14).sort((a, z) => blockEnd(z).localeCompare(blockEnd(a)));

  // год по неделям: сколько ординаторов у этого куратора в каждую неделю
  const perWeek = WEEKS.map((w) => mine.filter((b) => b.from <= w.num && w.num <= b.to).length);
  const threshold = SETTINGS.capacityThreshold;
  const finEnd = finishing[0] ? blockEnd(finishing[0]) : null;
  const overNow = current.length > threshold;

  return (
    <div className="flex flex-wrap gap-x-12 gap-y-6">
      <div className="w-full max-w-[760px]">
        <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
          <span className="text-[13px]" style={{ color: MUTE }}>Я заведующий</span>
          <Select value={curatorId} onValueChange={pick}>
            <SelectTrigger className="serif h-auto w-auto max-w-full border-0 border-b border-dotted bg-transparent px-0 py-0.5 text-[20px] shadow-none" style={{ borderColor: INK }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURATORS.map((c) => <SelectItem key={c.id} value={c.id}>{c.fio}</SelectItem>)}
            </SelectContent>
          </Select>
          {cur?.note && <span className="text-[13px]" style={{ color: MUTE }}>{cur.note}</span>}
        </div>

        <h2 className="serif mt-6 text-[22px] font-semibold">Сейчас у вас</h2>
        <p className="mb-1.5 text-[13px]" style={{ color: MUTE }}>
          {finishing.length > 0
            ? `${finishing.length === 1 ? "Одна ротация заканчивается" : finishing.length < 5 ? `${finishing.length} ротации заканчиваются` : `${finishing.length} ротаций заканчиваются`} ${finEnd ? weekdayIn(finEnd) : ""}. Доподпишите логбуки за все дни посещения.`
            : "Логбук подписывается за каждый день посещения."}
        </p>
        {current.length === 0 && <p className="py-2 text-[13px]" style={{ color: MUTE }}>Сейчас никого нет.</p>}
        {current.map((b) => <Entry key={b.id} b={b} blocks={blocks} date={date} kind="current" />)}

        <h2 className="serif mt-7 text-[22px] font-semibold">Придут к вам</h2>
        {future.length === 0 && <p className="py-2 text-[13px]" style={{ color: MUTE }}>Запланированных ротаций нет.</p>}
        {future.slice(0, 6).map((b) => <Entry key={b.id} b={b} blocks={blocks} date={date} kind="future" />)}

        {recent.length > 0 && (
          <>
            <h2 className="serif mt-7 text-[22px] font-semibold">Завершились недавно</h2>
            {recent.map((b) => <Entry key={b.id} b={b} blocks={blocks} date={date} kind="past" />)}
          </>
        )}

        {maybe.length > 0 && (
          <>
            <h2 className="serif mt-7 text-[22px] font-semibold">Возможно, ваши</h2>
            <p className="mb-1.5 text-[13px]" style={{ color: MUTE }}>Ротации в подразделении, где вы один из возможных кураторов. Назначает учебная часть или распорядитель.</p>
            {maybe.map((b) => <Entry key={b.id} b={b} blocks={blocks} date={date} kind="maybe" />)}
          </>
        )}
      </div>

      <div className="flex w-full max-w-[520px] flex-1 flex-col gap-4">
        <div className="bg-white p-4" style={{ border: `1px solid ${RULE}` }}>
          <div className="serif text-[16px] font-semibold">Эта неделя у вас</div>
          <div className="mt-3 flex gap-7">
            <div><div className="text-[30px] font-semibold leading-none">{current.length}</div><div className="mt-1 text-[12px]" style={{ color: MUTE }}>{current.length === 1 ? "ординатор сейчас" : "ординаторов сейчас"}</div></div>
            <div><div className="text-[30px] font-semibold leading-none" style={{ color: finishing.length ? RED : INK }}>{finishing.length}</div><div className="mt-1 text-[12px]" style={{ color: MUTE }}>{finEnd ? `заканчивают ${weekdayIn(finEnd)}` : "заканчивают на этой неделе"}</div></div>
            <div><div className="text-[30px] font-semibold leading-none">{soonN}</div><div className="mt-1 text-[12px]" style={{ color: MUTE }}>{soonN === 1 ? "придёт в ближайшие 3 дня" : "придут в ближайшие 3 дня"}</div></div>
          </div>
          {overNow && (
            <div className="mt-3 text-[12px] leading-relaxed" style={{ color: MUTE }}>
              {current.length} человек одновременно — больше порога {threshold}. Это заложено в графике, учебная часть в курсе.
            </div>
          )}
        </div>
        {mine.length > 0 && (
          <div className="bg-white p-4" style={{ border: `1px solid ${RULE}` }}>
            <div className="serif text-[16px] font-semibold">Ваш год по неделям</div>
            <div className="mt-3 flex h-11 items-end gap-[2px]">
              {perWeek.map((c, i) => (
                <div key={i} title={`неделя ${WEEKS[i].num}: ${c}`} className="flex-1"
                  style={{ height: c === 0 ? 2 : 8 + c * 6, background: c === 0 ? RULE : c > threshold ? RED : INK, outline: WEEKS[i].num === (WEEKS.find((w) => w.start <= date && date <= w.end)?.num ?? -1) ? `1px solid ${RED}` : undefined }} />
              ))}
            </div>
            <div className="mt-1.5 flex justify-between text-[11px]" style={{ color: MUTE }}>
              <span>{fmtLong(WEEKS[0].start).split(" ")[1]}</span><span>{fmtLong(WEEKS[Math.floor(WEEKS.length / 2)].start).split(" ")[1]}</span><span>{fmtLong(WEEKS.at(-1)!.end).split(" ")[1]}</span>
            </div>
          </div>
        )}
        <p className="text-[12px] leading-relaxed" style={{ color: MUTE }}>
          Напоминания о подписи логбука будут приходить в Telegram в 7:00 в предпоследний и последний день ротации. Пока рассылка не включена.
        </p>
      </div>
    </div>
  );
}
