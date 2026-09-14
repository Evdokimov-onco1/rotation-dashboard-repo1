import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WEEKS, OVERRIDES, SETTINGS, type User, type Week, type Override, fmtD, yearLabel } from "../data";
import { createOverride, deleteOverride, errText, updateWeeks } from "../api";
import { AMBER, FieldLabel, SectionCard } from "./common";

export function CalendarView({ user, onWeeksSaved, onOverridesChanged }:
  { user: User | null; onWeeksSaved: (w: Week[]) => void; onOverridesChanged: (o: Override[]) => void }) {
  const admin = user?.role === "admin";
  const [draft, setDraft] = useState<Week[]>(() => WEEKS.map((w) => ({ ...w })));
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ov, setOv] = useState({ dateFrom: "", dateTo: "", kind: "off" as "off" | "on", note: "" });

  useEffect(() => { setDraft(WEEKS.map((w) => ({ ...w }))); setDirty(false); }, [SETTINGS.year, WEEKS.length]);

  const edit = (num: number, patch: Partial<Week>) => {
    setDraft((d) => d.map((w) => (w.num === num ? { ...w, ...patch } : w)));
    setDirty(true);
  };

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await updateWeeks(SETTINGS.year, draft.map((w) => ({ num: w.num, isRotation: w.isRotation, note: w.note ?? null })));
      onWeeksSaved(r.weeks);
      setDirty(false);
      setMsg("Календарь сохранён.");
    } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  };

  const addOverride = async () => {
    if (!ov.dateFrom) { setMsg("Укажите дату начала исключения."); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await createOverride(SETTINGS.year, { dateFrom: ov.dateFrom, dateTo: ov.dateTo || ov.dateFrom, kind: ov.kind, note: ov.note });
      onOverridesChanged(r.overrides);
      setOv({ dateFrom: "", dateTo: "", kind: "off", note: "" });
    } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  };

  const removeOverride = async (id: number) => {
    setBusy(true); setMsg(null);
    try {
      const r = await deleteOverride(id);
      onOverridesChanged(r.overrides);
    } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  };

  const rotationWeeks = draft.filter((w) => w.isRotation).length;

  return (
    <div className="max-w-4xl space-y-4">
      <p className="text-sm text-muted-foreground">
        Учебный год {yearLabel()}: {draft.length} недель, из них с ротацией — {rotationWeeks}.
        Неделя без ротации остаётся в нумерации, но не считается в длительности блоков и не даёт дней для подписи логбука.
        Исключения по дням уточняют календарь с точностью до дня: праздник внутри учебной недели, рабочая суббота.
        {!admin && " Менять календарь может учебная часть."}
      </p>

      <SectionCard title="Недели" actions={admin && (
        <Button onClick={() => void save()} disabled={!dirty || busy}>{busy ? "…" : "Сохранить недели"}</Button>
      )}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="caps-label text-[10px] text-muted-foreground">
                <th className="border-b px-2 py-1 text-left">№</th>
                <th className="border-b px-2 py-1 text-left">Даты</th>
                <th className="border-b px-2 py-1 text-left">Ротация</th>
                <th className="border-b px-2 py-1 text-left">Примечание</th>
              </tr>
            </thead>
            <tbody>
              {draft.map((w) => (
                <tr key={w.num} className={w.isRotation ? "" : "bg-muted/60 text-muted-foreground"}>
                  <td className="mono border-b px-2 py-1">{w.num}</td>
                  <td className="mono border-b px-2 py-1 whitespace-nowrap">{fmtD(w.start)} – {fmtD(w.end)}</td>
                  <td className="border-b px-2 py-1">
                    <label className="flex items-center gap-1.5">
                      <input id={`week-${w.num}`} type="checkbox" checked={w.isRotation} disabled={!admin}
                        onChange={(e) => edit(w.num, { isRotation: e.target.checked })} />
                      <span className="text-xs">{w.isRotation ? "идёт" : "нет"}</span>
                    </label>
                  </td>
                  <td className="border-b px-2 py-1">
                    {admin ? (
                      <Input id={`note-${w.num}`} value={w.note ?? ""} placeholder="—" maxLength={255}
                        onChange={(e) => edit(w.num, { note: e.target.value })} className="h-7 bg-white text-xs" />
                    ) : (w.note ?? "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Исключения по дням" accent={AMBER}
        hint="«Ротации нет» — день не считается рабочим для блока и напоминаний. «Ротация идёт» — включить день, который иначе выходной.">
        {OVERRIDES.length === 0 && <p className="text-sm text-muted-foreground">Исключений нет.</p>}
        {OVERRIDES.map((o) => (
          <div key={o.id} className="flex flex-wrap items-center gap-3 border-b py-1.5 text-sm last:border-0">
            <span className="mono">{fmtD(o.dateFrom)}{o.dateTo !== o.dateFrom ? ` – ${fmtD(o.dateTo)}` : ""}</span>
            <span className={"rounded-[3px] px-1.5 py-0.5 text-xs " + (o.kind === "off" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900")}>
              {o.kind === "off" ? "ротации нет" : "ротация идёт"}
            </span>
            <span className="min-w-0 flex-1 text-muted-foreground">{o.note ?? ""}</span>
            {admin && <Button variant="ghost" size="sm" onClick={() => void removeOverride(o.id)} disabled={busy}>Удалить</Button>}
          </div>
        ))}
        {admin && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div><FieldLabel>С даты</FieldLabel>
              <Input id="ov-from" type="date" value={ov.dateFrom} onChange={(e) => setOv({ ...ov, dateFrom: e.target.value })} className="bg-white" /></div>
            <div><FieldLabel>По дату</FieldLabel>
              <Input id="ov-to" type="date" value={ov.dateTo} onChange={(e) => setOv({ ...ov, dateTo: e.target.value })} className="bg-white" /></div>
            <div><FieldLabel>Тип</FieldLabel>
              <Select value={ov.kind} onValueChange={(v) => setOv({ ...ov, kind: v as "off" | "on" })}>
                <SelectTrigger className="w-[170px] bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">ротации нет</SelectItem>
                  <SelectItem value="on">ротация идёт</SelectItem>
                </SelectContent>
              </Select></div>
            <div className="min-w-[200px] flex-1"><FieldLabel>Примечание</FieldLabel>
              <Input id="ov-note" value={ov.note} maxLength={255} placeholder="праздник, сессия…" onChange={(e) => setOv({ ...ov, note: e.target.value })} className="bg-white" /></div>
            <Button variant="outline" onClick={() => void addOverride()} disabled={busy}>+ Добавить</Button>
          </div>
        )}
      </SectionCard>

      {msg && <p className="text-sm" style={{ color: msg.includes("сохран") ? "#166534" : "#b91c1c" }}>{msg}</p>}
    </div>
  );
}
