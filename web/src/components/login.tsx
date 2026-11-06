"use client";

import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/client";
import { Button } from "./ui";
import { Mark } from "./shell";

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [token, setToken] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api("/api/auth/login", { method: "POST", json: { token } });
      onSuccess();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-[1120px] flex-col px-6">
      <div className="flex h-14 items-center gap-2.5">
        <Mark className="size-6" />
        <span className="text-[15px] font-semibold tracking-tight">Installer</span>
      </div>

      <div className="flex flex-1 flex-col justify-center pb-24">
        <h1 className="max-w-xl text-[44px] leading-[1.02] font-semibold tracking-[-0.04em] sm:text-[60px]">Deploy to this server.</h1>
        <p className="mt-5 max-w-md text-[16px] leading-relaxed text-muted">Sign in with the access token printed during setup.</p>

        <form onSubmit={submit} className="mt-10 max-w-md">
          <label htmlFor="token" className="mb-2 block font-mono text-[11px] tracking-[0.14em] text-faint uppercase">
            Access token
          </label>
          <div className="flex gap-2">
            <input
              id="token"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="••••••••••••••••"
              className="h-11 min-w-0 flex-1 rounded-ctl border border-line-strong bg-surface px-3.5 font-mono text-[13px] placeholder:text-faint focus:border-accent"
            />
            <Button type="submit" variant="primary" loading={busy} disabled={!token.trim()} className="h-11 px-5" icon={<ArrowRight className="size-4" />}>
              Sign in
            </Button>
          </div>
          {err && (
            <p role="alert" className="mt-3 text-[13px] text-danger">
              {err}
            </p>
          )}
          <p className="mt-5 text-[12px] text-faint">
            Lost it? On the VM run <code className="font-mono text-muted">sudo installer-ctl token</code>
          </p>
        </form>
      </div>
    </main>
  );
}
