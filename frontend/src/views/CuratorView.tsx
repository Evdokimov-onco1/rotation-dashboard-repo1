import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CURATORS, type Block, unitById, residentById, fmtD, blockRangeLabel, orgById } from "../data";
import { blockStatus, blockEnd, blockStart, diffDays, isComingSoon, isFinishing, nextDestText } from "../lib/calendar";
import { AMBER, PETROL, SectionCard, UnitDot } from "./common";

function ResidentName({ id }: { id: string }) {
  const r = residentById(id);
  const org = orgById(r.orgId);
  return (
    <>
      {r.fio}
      <span className="ml-1.5 text-xs font-normal text-muted-foreground">{org?.short} · {r.year} год</span>
    </>
  );
}

export function CuratorView({ blocks, date }: { blocks: Block[]; date: string }) {
  const [curatorId, setCuratorId] = useState<string>(CURATORS[0]?.id ?? "");
  const alive = blocks.filter((b) => residentById(b.residentId)?.active);
  const mine = alive.filter((b) => b.curatorId === curatorId);
  const maybe = alive.filter(
    (b) => !b.curatorId && unitById(b.unitId).candidates.includes(curatorId) && blockStatus(b, date) !== "past"
  );
  const current = mine.filter((b) => blockStatus(b, date) === "current");
  const recent = mine
    .filter((b) => blockStatus(b, date) === "past" && diffDays(blockEnd(b), date) <= 14)
    .sort((a, z) => blockEnd(z).localeCompare(blockEnd(a)));
  const future = mine
    .filter((b) => blockStatus(b, date) === "future")
    .sort((a, z) => blockStart(a).localeCompare(blockStart(z)));

  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="caps-label text-[11px] text-muted-foreground">Я — заведующий</span>
        <Select value={curatorId} onValueChange={setCuratorId}>
          <SelectTrigger className="w-full max-w-[430px] bg-white"><SelectValue /></SelectTrigger>
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
                    <ResidentName id={b.residentId} />
                    <span className="ml-2 mono text-xs text-muted-foreground">до {fmtD(blockEnd(b))}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {unitById(b.unitId).name} · <span className="mono text-[13px]">{blockRangeLabel(b)}</span>
                  </div>
                  {fin && (
                    <div className="mt-1.5 rounded-[3px] border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-sm">
                      <span className="font-medium" style={{ color: AMBER }}>
                        Завершается {fmtD(blockEnd(b))} — доподпишите логбук за все дни.
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
          {future.slice(0, 6).map((b) => {
            const soon = isComingSoon(b, date);
            const dd = diffDays(date, blockStart(b));
            return (
              <div key={b.id} className="flex items-start gap-3 border-b py-2 last:border-0">
                <UnitDot unitId={b.unitId} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    <ResidentName id={b.residentId} />
                    {soon ? (
                      <Badge className="ml-2 align-middle" style={{ background: AMBER }}>
                        через {dd} {dd === 1 ? "день" : "дн."} · {fmtD(blockStart(b))}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="ml-2 mono align-middle font-normal">
                        с {fmtD(blockStart(b))}
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
                  <span className="mono text-[13px]">недели {b.from}–{b.to}</span>, завершилась {fmtD(blockEnd(b))}
                </span>
              </div>
            ))}
          </SectionCard>
        )}

        {maybe.length > 0 && (
          <SectionCard title="Возможно, ваши" accent={AMBER} className="bg-amber-50/60"
            hint="Ротации в подразделении, где вы — один из возможных кураторов. Назначение делает учебная часть или распорядитель.">
            {maybe.map((b) => (
              <div key={b.id} className="flex items-start gap-3 border-b py-2 last:border-0">
                <UnitDot unitId={b.unitId} />
                <div className="min-w-0">
                  <div className="text-sm font-medium"><ResidentName id={b.residentId} /></div>
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
