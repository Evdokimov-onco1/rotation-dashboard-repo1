import { useCallback, useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  WEEKS, UNITS, RESIDENTS, YEARS, OVERRIDES, SETTINGS, setScheduleData,
  type Block, type Resident, type User, type Week, type Override,
  weekByNum, fmtD, yearLabel,
} from "./data";
import { errText, fetchSchedule, authLogout } from "./api";
import { currentWeekNum } from "./lib/calendar";
import { INK, PETROL, canEditOrg } from "./views/common";
import { CuratorView } from "./views/CuratorView";
import { Matrix, type MatrixFilter } from "./views/Matrix";
import { EduView } from "./views/EduView";
import { CalendarView } from "./views/CalendarView";
import { AdminView } from "./views/AdminView";
import { BlockDialog, type EditorState } from "./views/BlockDialog";

const tabCls = "caps-label rounded-none border-b-2 border-transparent bg-transparent px-0 pb-2 pt-1 text-[11px] " +
  "data-[state=active]:border-current data-[state=active]:bg-transparent data-[state=active]:shadow-none";

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

  const openEditor = (b: Block | null) => {
    if (b) {
      setEditor({ id: b.id, residentId: b.residentId, unitId: b.unitId, from: b.from, to: b.to, curatorId: b.curatorId, comment: b.comment ?? "" });
      return;
    }
    const first = RESIDENTS.find((r) => r.active && canEditOrg(user, r.orgId)) ?? RESIDENTS[0];
    if (!first) return;
    setEditor({ id: null, residentId: first.id, unitId: UNITS[0].id, from: 1, to: 4, curatorId: UNITS[0].candidates[0] ?? null, comment: "" });
  };

  const curW = useMemo(() => (today ? currentWeekNum(today) : null), [today, loaded, tick]);
  const week = curW ? weekByNum(curW) : null;
  const yearIsCurrent = YEARS.find((y) => y.id === year)?.isCurrent ?? true;

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <Card className="max-w-md">
          <CardHeader><CardTitle className="text-base">Не удалось загрузить график</CardTitle></CardHeader>
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
              <h1 className="text-xl font-semibold leading-tight">Ротации ординаторов · {yearLabel()}</h1>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {YEARS.length > 1 && (
              <div>
                <span className="caps-label block text-[10px] text-muted-foreground">учебный год</span>
                <Select value={year} onValueChange={(v) => { setNotice(null); void load(false, v); }}>
                  <SelectTrigger className="h-8 w-[150px] bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {YEARS.map((y) => <SelectItem key={y.id} value={y.id}>{y.label}{y.isCurrent ? " · текущий" : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="text-right">
              <span className="caps-label text-[10px] text-muted-foreground">сегодня</span>
              <div className="mono text-sm">{fmtD(today)}</div>
            </div>
          </div>
        </div>
        {notice && (
          <div className="border-t bg-red-50 px-5 py-1 text-center text-xs text-red-800">{notice}</div>
        )}
        {!yearIsCurrent && (
          <div className="border-t bg-amber-50 px-5 py-1 text-center text-xs text-amber-900">
            Вы смотрите архив: {yearLabel()}. Кабинеты считаются от сегодняшней даты, поэтому в архиве они пусты.
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1400px] px-5 py-5">
        <Tabs defaultValue="curator">
          <TabsList className="mb-5 h-auto w-full flex-wrap justify-start gap-6 rounded-none border-b bg-transparent p-0">
            <TabsTrigger className={tabCls} value="curator">Кабинет куратора</TabsTrigger>
            <TabsTrigger className={tabCls} value="matrix">Матрица</TabsTrigger>
            <TabsTrigger className={tabCls} value="calendar">Календарь</TabsTrigger>
            <TabsTrigger className={tabCls} value="edu">Учебная часть{user && " 🔓"}</TabsTrigger>
            <TabsTrigger className={tabCls} value="admin">Админка{user && " 🔓"}</TabsTrigger>
          </TabsList>
          <TabsContent value="curator">
            <CuratorView blocks={blocks} date={today} />
          </TabsContent>
          <TabsContent value="matrix">
            <Matrix blocks={blocks} date={today} onCellClick={(b) => openEditor(b)} filter={filter} setFilter={setFilter} />
          </TabsContent>
          <TabsContent value="calendar">
            <CalendarView key={year + ":" + tick} user={user} onWeeksSaved={applyWeeks} onOverridesChanged={applyOverrides} />
          </TabsContent>
          <TabsContent value="edu">
            <EduView blocks={blocks} date={today} user={user} onLogin={setUser} onLogout={() => void logout()} />
          </TabsContent>
          <TabsContent value="admin">
            <AdminView blocks={blocks} date={today} user={user}
              onLogin={setUser} onLogout={() => void logout()}
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
