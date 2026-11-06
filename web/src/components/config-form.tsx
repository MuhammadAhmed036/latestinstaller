"use client";

import { Eye, EyeOff, Info } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type FieldView, type SystemView } from "@/lib/client";
import { isVisible } from "@/lib/fields";
import { cn } from "./ui";

type PortResult = Record<string, { port: number; ok: boolean; suggest?: number; reason?: string }>;

export function fieldError(f: FieldView, v: string): string | null {
  const t = v.trim();
  if (!t) return f.optional ? null : "Required";
  if (f.kind === "port" && (!/^\d+$/.test(t) || Number(t) < 1 || Number(t) > 65535)) return "Enter a port from 1 to 65535";
  if (f.kind === "select" && !f.options?.some((o) => o.value === t)) return "Choose an option";
  if (f.pattern && !new RegExp(f.pattern).test(t)) return f.patternMsg ?? "Invalid value";
  return null;
}

/**
 * Renders the questions the bundle's script asks, pre-filled from the current install.
 * Fields appear and disappear exactly like the script's questions do. Reports validity upward so
 * Deploy stays disabled while anything is wrong or a port is taken.
 */
export function ConfigForm({
  sys,
  values,
  setValues,
  onValid,
  existing,
  setExisting,
}: {
  sys: SystemView;
  values: Record<string, string>;
  setValues: (v: Record<string, string>) => void;
  onValid: (ok: boolean) => void;
  existing: boolean;
  setExisting: (b: boolean) => void;
}) {
  const fields = useMemo(() => sys.fields ?? [], [sys.fields]);
  const [loaded, setLoaded] = useState(false);
  const [skipped, setSkipped] = useState<Record<string, string>>({});
  const [ports, setPorts] = useState<PortResult>({});
  const [checking, setChecking] = useState(false);
  const [showPass, setShowPass] = useState<Record<string, boolean>>({});
  const seq = useRef(0);
  const skippedKeys = useMemo(() => Object.keys(skipped), [skipped]);

  useEffect(() => {
    setLoaded(false);
    api<{ values: Record<string, string>; existing: boolean; skipped: Record<string, string> }>(`/api/systems/defaults?system=${sys.id}`)
      .then((r) => {
        setValues(r.values);
        setExisting(r.existing);
        setSkipped(r.skipped ?? {});
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [sys.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = fields.filter((f) => isVisible(f, values, skippedKeys));
  const portKey = visible.filter((f) => f.kind === "port").map((f) => `${f.key}=${values[f.key] ?? ""}`).join(",");

  useEffect(() => {
    if (!loaded) return;
    const id = ++seq.current;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const r = await api<{ result: PortResult }>("/api/systems/check-ports", { method: "POST", json: { system: sys.id, ports: values } });
        if (id === seq.current) setPorts(r.result);
      } catch {
        /* keep previous */
      } finally {
        if (id === seq.current) setChecking(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [portKey, loaded, sys.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors: Record<string, string | null> = {};
  for (const f of visible) errors[f.key] = fieldError(f, values[f.key] ?? "");
  const portBad = visible.some((f) => f.kind === "port" && ports[f.key] && !ports[f.key].ok);
  const valid = loaded && !checking && Object.values(errors).every((e) => !e) && !portBad;

  useEffect(() => onValid(valid), [valid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!loaded) return <div className="h-48 animate-pulse rounded-panel border border-line bg-surface" />;

  const set = (k: string, v: string) => setValues({ ...values, [k]: v });

  return (
    <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
      {fields
        .filter((f) => (f.skipIfEnv || f.skipIfFile) && skipped[f.key])
        .map((f) => (
          <div key={f.key} className="flex gap-3 rounded-ctl border border-line bg-surface px-4 py-3 text-[13px] sm:col-span-2">
            <Info className="mt-0.5 size-4 shrink-0 text-muted" />
            {f.skipIfFile ? (
              <p className="min-w-0 text-muted">
                <span className="text-fg">{f.label}:</span> {f.skipNote ?? "already configured on this machine, kept as is."}
              </p>
            ) : (
              <p className="min-w-0 text-muted">
                <span className="text-fg">{f.label}</span> is already set in the installed <span className="font-mono">.env</span> and will be kept:{" "}
                <span className="font-mono break-all text-fg">{skipped[f.key]}</span>
              </p>
            )}
          </div>
        ))}

      {visible.map((f) => {
        const err = errors[f.key];
        const p = f.kind === "port" ? ports[f.key] : undefined;
        const taken = p && !p.ok;
        const wide = f.wide || f.kind === "password" || f.kind === "select";
        const val = values[f.key] ?? "";

        if (f.kind === "select") {
          return (
            <div key={f.key} className="sm:col-span-2">
              <div className="mb-2 font-mono text-[11px] tracking-[0.12em] text-faint uppercase" id={`l-${f.key}`}>
                {f.label}
              </div>
              <div role="radiogroup" aria-labelledby={`l-${f.key}`} className="overflow-hidden rounded-panel border border-line">
                {f.options?.map((o) => {
                  const on = val === o.value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => set(f.key, o.value)}
                      className={cn(
                        "relative flex w-full cursor-pointer items-start gap-3 border-b border-line px-4 py-3 text-left last:border-b-0",
                        on ? "bg-raised" : "hover:bg-surface",
                      )}
                    >
                      {on && <span className="absolute inset-y-0 left-0 w-[2px] bg-accent" aria-hidden />}
                      <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border", on ? "border-accent" : "border-line-strong")}>
                        {on && <span className="size-2 rounded-full bg-accent" />}
                      </span>
                      <span>
                        <span className="block text-[14px] font-medium">{o.label}</span>
                        {o.hint && <span className="block text-[12px] text-muted">{o.hint}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        }

        return (
          <div key={f.key} className={cn(wide && "sm:col-span-2")}>
            <label htmlFor={`f-${f.key}`} className="mb-2 flex items-baseline justify-between font-mono text-[11px] tracking-[0.12em] text-faint uppercase">
              <span>
                {f.label}
                {f.optional && f.kind !== "password" && <span className="ml-2 normal-case tracking-normal">optional</span>}
              </span>
              {f.kind === "port" && !taken && !err && p && <span className="text-ok normal-case tracking-normal">free</span>}
            </label>
            <div className="relative">
              <input
                id={`f-${f.key}`}
                type={f.kind === "password" && !showPass[f.key] ? "password" : "text"}
                inputMode={f.kind === "port" ? "numeric" : undefined}
                autoComplete={f.kind === "password" ? "new-password" : "off"}
                spellCheck={false}
                value={val}
                onChange={(e) => set(f.key, e.target.value)}
                placeholder={f.kind === "password" ? (f.placeholder ?? (existing ? "Keep current password" : "Generate automatically")) : f.placeholder}
                aria-invalid={!!err || !!taken}
                className={cn(
                  "h-10 w-full rounded-ctl border bg-surface px-3 font-mono text-[13px] placeholder:font-sans placeholder:text-faint focus:border-accent",
                  (val !== "" || f.kind === "port") && (err || taken) ? "border-danger/60" : "border-line-strong",
                  f.kind === "password" && "pr-10",
                )}
              />
              {f.kind === "password" && (
                <button
                  type="button"
                  onClick={() => setShowPass((s) => ({ ...s, [f.key]: !s[f.key] }))}
                  aria-label={showPass[f.key] ? "Hide password" : "Show password"}
                  className="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer text-muted hover:text-fg"
                >
                  {showPass[f.key] ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              )}
            </div>
            {taken ? (
              <p className="mt-1.5 text-[12px] text-danger">
                Port {p.port} is {p.reason}.{" "}
                {p.suggest && (
                  <button type="button" onClick={() => set(f.key, String(p.suggest))} className="cursor-pointer text-fg underline underline-offset-2">
                    Use {p.suggest}
                  </button>
                )}
              </p>
            ) : err && (val !== "" || f.kind === "port") ? (
              <p className="mt-1.5 text-[12px] text-danger">{err}</p>
            ) : (
              f.hint && <p className="mt-1.5 text-[12px] text-faint">{f.hint}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
