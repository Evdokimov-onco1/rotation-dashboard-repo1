import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  WEEKS, UNITS, RESIDENTS, SETTINGS, type Block, type User,
  unitById, curatorById, residentById, blockRangeLabel, orgById,
} from "../data";
import { createBlock, updateBlock, deleteBlock, errText, type BlockInput } from "../api";
import { AMBER, FieldLabel, canEditOrg } from "./common";

export interface EditorState {
  id: string | null; residentId: string; unitId: string;
  from: number; to: number; curatorId: string | null; comment: string;
}

export function BlockDialog({ state, setState, user, blocks, onSaved, onDeleted, onClose }:
  {
    state: EditorState; setState: (s: EditorState) => void; user: User | null;
    blocks: Block[];
    onSaved: (b: Block) => void; onDeleted: (id: string) => void; onClose: () => void;
  }) {
  const u = unitById(state.unitId);
  const isNew = state.id === null;
  const resident = residentById(state.residentId);
  const admin = canEditOrg(user, resident?.orgId ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const editableResidents = RESIDENTS.filter((r) => r.active && canEditOrg(user, r.orgId));

  const overlap = () =>
    blocks.some((b) =>
      b.id !== state.id && b.residentId === state.residentId &&
      !(state.to < b.from || b.to < state.from));

  const save = async () => {
    if (state.from > state.to) { setMsg("Неделя начала позже недели окончания."); return; }
    if (overlap()) { setMsg("Пересекается с другим блоком этого ординатора."); return; }
    const payload: BlockInput = {
      residentId: state.residentId, unitId: state.unitId,
      from: state.from, to: state.to,
      curatorId: u.rule === "auto" ? (u.candidates[0] ?? null) : state.curatorId,
      comment: state.comment.trim() === "" ? null : state.comment.trim(),
    };
    setBusy(true);
    try {
      const res = isNew ? await createBlock(payload, SETTINGS.year) : await updateBlock(state.id!, payload);
      onSaved(res.block);
      onClose();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!window.confirm("Удалить блок ротации?")) return;
    setBusy(true);
    try {
      await deleteBlock(state.id!);
      onDeleted(state.id!);
      onClose();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const weekOpts = WEEKS.map((w) => (
    <SelectItem key={w.num} value={String(w.num)}>№{w.num} · {w.label}{w.isRotation ? "" : " · нет ротации"}</SelectItem>
  ));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">
            {admin ? (isNew ? "Новый блок ротации" : "Редактирование блока") : "Блок ротации"}
          </DialogTitle>
        </DialogHeader>

        {!admin ? (
          <div className="space-y-1 text-sm">
            <p className="font-medium">{resident?.fio}
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">{orgById(resident?.orgId ?? "")?.short} · {resident?.year} год</span>
            </p>
            <p>{u.name}</p>
            <p className="mono text-muted-foreground">{blockRangeLabel(state)}</p>
            <p className={state.curatorId ? "text-muted-foreground" : ""} style={state.curatorId ? undefined : { color: AMBER }}>
              {state.curatorId ? "Куратор: " + curatorById(state.curatorId)!.fio : "⚠️ куратор не назначен"}
            </p>
            {state.comment !== "" && <p className="text-muted-foreground">Комментарий: {state.comment}</p>}
            <p className="pt-2 text-xs opacity-60">
              {user ? "Этот блок относится к другой организации, править его вы не можете."
                : "Для правки войдите во вкладке «Админка»."}
            </p>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div>
              <FieldLabel>Ординатор</FieldLabel>
              <Select value={state.residentId} onValueChange={(v) => setState({ ...state, residentId: v })}>
                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>{editableResidents.map((r) =>
                  <SelectItem key={r.id} value={r.id}>{r.fio} · {orgById(r.orgId)?.short} · {r.year} год</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <FieldLabel>Подразделение</FieldLabel>
              <Select value={state.unitId}
                onValueChange={(v) => setState({ ...state, unitId: v, curatorId: unitById(v).rule === "auto" ? unitById(v).candidates[0] : null })}>
                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>{UNITS.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <FieldLabel>С недели</FieldLabel>
                <Select value={String(state.from)} onValueChange={(v) => setState({ ...state, from: +v })}>
                  <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>{weekOpts}</SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <FieldLabel>По неделю</FieldLabel>
                <Select value={String(state.to)} onValueChange={(v) => setState({ ...state, to: +v })}>
                  <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>{weekOpts}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <FieldLabel>
                Куратор {u.rule === "auto" && <span className="normal-case tracking-normal opacity-60">(назначается автоматически)</span>}
              </FieldLabel>
              {u.rule === "auto" ? (
                <p className="border border-border bg-muted px-3 py-2">{curatorById(u.candidates[0])?.fio ?? "—"}</p>
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
            <div>
              <FieldLabel>Комментарий (необязательно)</FieldLabel>
              <Input id="block-comment" value={state.comment} maxLength={500}
                onChange={(e) => setState({ ...state, comment: e.target.value })}
                className="bg-white" />
            </div>
            {msg && <p className="text-sm text-red-700">{msg}</p>}
          </div>
        )}

        {admin && (
          <DialogFooter className="gap-2">
            {!isNew && <Button variant="destructive" onClick={() => void del()} disabled={busy}>Удалить</Button>}
            <Button variant="outline" onClick={onClose} disabled={busy}>Отмена</Button>
            <Button onClick={() => void save()} disabled={busy}>{busy ? "Сохранение…" : "Сохранить"}</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
