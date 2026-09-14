import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { type Block, type User, unitById, curatorById, residentById, fmtD, blockRangeLabel } from "../data";
import { blockStatus, blockEnd, blockStart, isComingSoon, isFinishing, nextDestText } from "../lib/calendar";
import { AMBER, LoginGate, SectionCard } from "./common";

export function EduView({ blocks, date, user, onLogin, onLogout }:
  { blocks: Block[]; date: string; user: User | null; onLogin: (u: User) => void; onLogout: () => void }) {
  if (!user) {
    return (
      <LoginGate
        title="Кабинет учебной части"
        desc="Сводка задач кураторов на сегодня. Вход по логину и паролю учебной части или распорядителя."
        onLogin={onLogin}
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
    if (!residentById(b.residentId)?.active) continue;
    const st = blockStatus(b, date);
    if (!b.curatorId) { if (st !== "past") unassigned.push(b); continue; }
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
        <Button variant="ghost" onClick={onLogout}>Выйти</Button>
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
                  последний день <span className="mono">{fmtD(blockEnd(b))}</span>
                  <span className="text-muted-foreground"> · далее: {nextDestText(blocks, b)}</span>
                </div>
              ))}
              {t.incoming.map((b) => (
                <div key={b.id} className="text-sm">
                  <Badge variant="outline" className="mr-2 align-middle">принимает</Badge>
                  {residentById(b.residentId).fio} — {unitById(b.unitId).short},{" "}
                  с <span className="mono">{fmtD(blockStart(b))}</span>{" "}
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
        <SectionCard title="Задача: назначить кураторов" accent={AMBER} className="bg-amber-50/60">
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
                  старт {fmtD(blockStart(b))}
                </Badge>
              </div>
            );
          })}
          <p className="pt-2 text-xs text-muted-foreground">Назначение — во вкладке «Админка».</p>
        </SectionCard>
      )}

      <p className="text-xs text-muted-foreground">
        «Доподписать» появляется в предпоследний и последний день курации, «принимает» — за 3 дня до
        начала ротации: те же окна, что у Telegram-напоминаний. Дни считаются по календарю ротации.
      </p>
    </div>
  );
}
