import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { unitById, orgById, type User } from "../data";
import { authLogin, errText } from "../api";

/* палитра «Пост отделения» */
export const INK = "#16323c";
export const PETROL = "#0f4c5c";
export const AMBER = "#b45309";

export const ROLE_LABEL: Record<User["role"], string> = { admin: "учебная часть", dispatcher: "распорядитель" };

export const canEditOrg = (user: User | null, orgId: string) =>
  !!user && (user.role === "admin" || user.orgId === orgId);

export const userScopeText = (user: User) =>
  user.role === "admin"
    ? "учебная часть, доступ ко всем данным"
    : `распорядитель когорты ${orgById(user.orgId ?? "")?.short ?? user.orgId}`;

export function LoginGate({ title, desc, onLogin }: { title: string; desc: string; onLogin: (u: User) => void }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (login === "" || password === "" || busy) return;
    setBusy(true);
    try {
      const r = await authLogin(login.trim(), password);
      setPassword("");
      onLogin(r.user);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="max-w-sm">
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{desc}</p>
        <div className="grid gap-2">
          <Input id="login" autoComplete="username" placeholder="Логин" value={login}
            onChange={(e) => { setLogin(e.target.value); setErr(null); }}
            onKeyDown={(e) => e.key === "Enter" && void submit()} className="bg-white" />
          <Input id="password" type="password" autoComplete="current-password" placeholder="Пароль" value={password}
            onChange={(e) => { setPassword(e.target.value); setErr(null); }}
            onKeyDown={(e) => e.key === "Enter" && void submit()} className="bg-white" />
          <Button onClick={() => void submit()} disabled={busy}>{busy ? "…" : "Войти"}</Button>
        </div>
        {err && <p className="text-sm text-red-700">{err}</p>}
      </CardContent>
    </Card>
  );
}

export function UnitDot({ unitId }: { unitId: string }) {
  return <span className="mt-1 h-3 w-3 shrink-0 rounded-[2px]" style={{ background: unitById(unitId).color }} />;
}

export function SectionCard({ title, hint, accent, children, className = "", actions }:
  { title: string; hint?: string; accent?: string; children: React.ReactNode; className?: string; actions?: React.ReactNode }) {
  return (
    <Card className={"border " + className} style={accent ? { borderLeft: `3px solid ${accent}` } : undefined}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-[15px]">{title}</CardTitle>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          </div>
          {actions}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="caps-label mb-1 block text-[10px] text-muted-foreground">{children}</label>;
}
