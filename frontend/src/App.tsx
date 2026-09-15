import { useCallback, useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  WEEKS, UNITS, RESIDENTS, YEARS, OVERRIDES, ORGS, SETTINGS, setScheduleData,
  type Block, type Resident, type User, type Week, type Override,
  weekByNum, yearLabel, orgTitle,
} from "./data";
import { errText, fetchSchedule, authLogout } from "./api";
import { currentWeekNum } from "./lib/calendar";
import { RED, MUTE, RULE, canEditOrg, fmtLong, weekdayName } from "./views/common";
import { CuratorView } from "./views/CuratorView";
import { ResidentView } from "./views/ResidentView";
import { Matrix, type MatrixFilter } from "./views/Matrix";
import { EduView } from "./views/EduView";
import { CalendarView } from "./views/CalendarView";
import { AdminView } from "./views/AdminView";
import { BlockDialog, type EditorState } from "./views/BlockDialog";

const tabCls = "rounded-none border-b-2 border-transparent bg-transparent px-0 pb-2.5 pt-1 text-[14px] font-normal text-[color:var(--mute)] " +
  "data-[state=active]:border-[color:var(--ink)] data-[state=active]:bg-transparent data-[state=active]:font-medium data-[state=active]:text-[color:var(--ink)] data-[state=active]:shadow-none";

export default function App() {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [today, setToday] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [year, setYear] = useState<string | undefined>(undefined);
  const [tick, setTick] = useState(0); // перерисовка после правок справочников
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [filter, setFilter] = useState<MatrixFilter>({ orgId: "all", year: "all" });
  // постоянные ссылки: #r=<ординатор> и #c=<заведующий>
  const hash = /^#(r|c)=(.+)$/.exec(location.hash);
  const [tab, setTab] = useState<string>(hash?.[1] === "r" ? "resident" : "curator");
  const [linkId] = useState<string | null>(hash ? decodeURIComponent(hash[2]) : null);
  const remember = (kind: "r" | "c", id: string) => history.replaceState(null, "", `#${kind}=${id}`);

  const load = useCallback(async (initial: boolean, y?: string) => {
    try {
      const s = await fetchSchedule(y);
      setScheduleData(s);
      setBlocks(s.blocks);
      setToday(s.today);
      setUser(s.user);
      setYear(s.year);
      setLoadError(null);
      setLoaded(true);
      setTick((t) => t + 1);
    } catch (e) {
      if (initial) setLoadError(errText(e));
      else setNotice(errText(e));
    }
  }, []);

  useEffect(() => { void load(true); }, [load]);

  // правки с других компьютеров подтягиваются при возвращении на вкладку
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && loaded) void load(false, year);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load, loaded, year]);

  const logout = async () => {
    try { await authLogout(); } catch { /* сессия и так закрыта */ }
    setUser(null);
  };

  const applyBlock = (b: Block) =>
    setBlocks((prev) => prev.some((x) => x.id === b.id)
      ? prev.map((x) => (x.id === b.id ? b : x))
      : [...prev, b]);
  const removeBlock = (id: string) =>
    setBlocks((prev) => prev.filter((x) => x.id !== id));
  const applyResident = (r: Resident) => {
    const i = RESIDENTS.findIndex((x) => x.id === r.id);
    if (i >= 0) RESIDENTS[i] = r; else RESIDENTS.push(r);
    setTick((t) => t + 1);
  };
  const applyWeeks = (w: Week[]) => { WEEKS.splice(0, WEEKS.length, ...w); setTick((t) => t + 1); };
  const applyOverrides = (o: Override[]) => { OVERRIDES.splice(0, OVERRIDES.length, ...o); setTick((t) => t + 1); };

  const openEditor = (b: Block | null, at?: { residentId: string; week: number }) => {
    if (b) {
      setEditor({ id: b.id, residentId: b.residentId, unitId: b.unitId, from: b.from, to: b.to, curatorId: b.curatorId, comment: b.comment ?? "" });
      return;
    }
    const first = at ? RESIDENTS.find((r) => r.id === at.residentId) : (RESIDENTS.find((r) => r.active && canEditOrg(user, r.orgId)) ?? RESIDENTS[0]);
    if (!first) return;
    const last = WEEKS.at(-1)?.num ?? 35;
    const from = at ? at.week : 1;
    setEditor({ id: null, residentId: first.id, unitId: UNITS[0].id, from, to: Math.min(last, from + 3), curatorId: UNITS[0].candidates[0] ?? null, comment: "" });
  };

  const curW = useMemo(() => (today ? currentWeekNum(today) : null), [today, loaded, tick]);
  const week = curW ? weekByNum(curW) : null;
  const yearIsCurrent = YEARS.find((y) => y.id === year)?.isCurrent ?? true;
  const orgsText = ORGS.map(orgTitle).join(" и ");

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <Card className="max-w-md">
          <CardHeader><CardTitle className="serif text-lg">Не удалось загрузить график</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{loadError}</p>
            <Button onClick={() => void load(true)}>Повторить</Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Загрузка графика…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto max-w-[1440px] px-10 pt-7">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="serif text-[32px] font-semibold leading-[1.1]">Ротации ординаторов</h1>
            <p className="mt-1.5 text-[14px]" style={{ color: MUTE }}>
              Учебный год {yearLabel()}, {orgsText}. Сегодня {weekdayName(today)}, {fmtLong(today)}.
            </p>
          </div>
          <div className="flex items-center gap-6">
            {YEARS.length > 1 && (
              <Select value={year} onValueChange={(v) => { setNotice(null); void load(false, v); }}>
                <SelectTrigger className="h-9 w-[210px] bg-white text-[13px]" style={{ borderColor: RULE }}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {YEARS.map((y) => <SelectItem key={y.id} value={y.id}>{y.label}{y.isCurrent ? ", текущий год" : ", архив"}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <div className="inline-flex flex-col items-center rounded-[3px] px-3.5 pb-2 pt-1.5 leading-none"
              style={{ border: `2px solid ${RED}`, color: RED, transform: "rotate(-2deg)", opacity: 0.92 }}>
              <span className="text-[11px]">неделя</span>
              <span className="my-0.5 text-[30px] font-semibold">{curW ?? "—"}</span>
              <span className="text-[11px]">{week ? `${fmtLong(week.start).split(" ")[0]}–${fmtLong(week.end)}` : "вне учебного года"}</span>
            </div>
          </div>
        </div>
        {notice && (
          <div className="mt-3 text-[13px]" style={{ color: RED }}>{notice}</div>
        )}
        {!yearIsCurrent && (
          <div className="mt-3 text-[13px]" style={{ color: MUTE }}>
            Это архив {yearLabel()}. Кабинеты считаются от сегодняшней даты, поэтому в архиве они пусты.
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1440px] px-10 pb-10">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-6 mt-6 h-auto w-full flex-wrap justify-start gap-7 rounded-none bg-transparent p-0" style={{ borderBottom: `1px solid ${RULE}` }}>
            <TabsTrigger className={tabCls} value="curator">Кабинет заведующего</TabsTrigger>
            <TabsTrigger className={tabCls} value="resident">Кабинет ординатора</TabsTrigger>
            <TabsTrigger className={tabCls} value="matrix">График года</TabsTrigger>
            <TabsTrigger className={tabCls} value="calendar">Календарь</TabsTrigger>
            <TabsTrigger className={tabCls} value="edu">Учебная часть</TabsTrigger>
            <TabsTrigger className={tabCls} value="admin">{user ? "Правка" : "Вход"}</TabsTrigger>
          </TabsList>
          <TabsContent value="curator">
            <CuratorView blocks={blocks} date={today} initialId={hash?.[1] === "c" ? linkId : null} onSelect={(id) => remember("c", id)} />
          </TabsContent>
          <TabsContent value="resident">
            <ResidentView blocks={blocks} date={today} initialId={hash?.[1] === "r" ? linkId : null} onSelect={(id) => remember("r", id)} />
          </TabsContent>
          <TabsContent value="matrix">
            <Matrix blocks={blocks} date={today} user={user} onLoginClick={() => setTab("admin")}
              onCellClick={(b) => openEditor(b)} onCreateAt={(rid, w) => openEditor(null, { residentId: rid, week: w })}
              onBlockChanged={applyBlock} filter={filter} setFilter={setFilter} />
          </TabsContent>
          <TabsContent value="calendar">
            <CalendarView key={year + ":" + tick} user={user} onWeeksSaved={applyWeeks} onOverridesChanged={applyOverrides} />
          </TabsContent>
          <TabsContent value="edu">
            <EduView blocks={blocks} date={today} user={user} onLogin={setUser} onLogout={() => void logout()} />
          </TabsContent>
          <TabsContent value="admin">
            <AdminView blocks={blocks} date={today} user={user}
              onLogin={(u) => { setUser(u); setTab("matrix"); }} onLogout={() => void logout()}
              openEditor={openEditor} onBlockChanged={applyBlock} onBlocksReplaced={setBlocks}
              onResidentChanged={applyResident} onYearsChanged={() => void load(false, year)}
              onThresholdChanged={(n) => { SETTINGS.capacityThreshold = n; setTick((t) => t + 1); }} />
          </TabsContent>
        </Tabs>
      </main>

      {editor && (
        <BlockDialog state={editor} setState={setEditor} user={user}
          blocks={blocks} onSaved={applyBlock} onDeleted={removeBlock} onClose={() => setEditor(null)} />
      )}
    </div>
  );
}
