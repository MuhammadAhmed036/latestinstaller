"use client";

import { LogOut } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { OTHER_ID, api, type SystemView } from "@/lib/client";
import { DeployView } from "./deploy-view";
import { HistoryView } from "./history-view";
import { Login } from "./login";
import { ManageView } from "./manage-view";
import { UploadView } from "./upload-view";
import { Spinner, cn } from "./ui";

export type HostInfo = { version: string; hostname?: string; os?: string; ip?: string; docker?: string; free?: string; root?: string };

/** Each registered system becomes a tab (from systems.json). History is always last. */
const HISTORY = "history";
const UPLOAD = "upload";

export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <rect width="24" height="24" rx="6" fill="#fafafa" />
      <path d="M12 5.5v8m0 0-3.2-3.2M12 13.5l3.2-3.2M6.5 17.5h11" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Shell() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [host, setHost] = useState<HostInfo | null>(null);
  const [systems, setSystems] = useState<SystemView[]>([]);
  const [view, setView] = useState<string>("");
  const [unclaimed, setUnclaimed] = useState(0);
  const [openJob, setOpenJob] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setHost(await api<HostInfo>("/api/host"));
      const r = await api<{ systems: SystemView[] }>("/api/systems");
      setSystems(r.systems);
      const h = window.location.hash.slice(1);
      setView((v) => v || (h && (h === HISTORY || h === UPLOAD || r.systems.some((x) => x.id === h)) ? h : r.systems[0]?.id || HISTORY));
      setAuthed(true);
    } catch {
      setAuthed(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Bundles no system claims (even by their contents) get an "Other" tab so nothing is ever hidden.
  useEffect(() => {
    if (!authed) return;
    const tick = () =>
      api<{ packages: { system: unknown }[] }>("/api/packages")
        .then((r) => setUnclaimed(r.packages.filter((p) => !p.system).length))
        .catch(() => {});
    tick();
    const t = setInterval(tick, 10_000);
    return () => clearInterval(t);
  }, [authed]);

  if (authed === null)
    return (
      <div className="grid min-h-screen place-items-center text-muted">
        <Spinner className="size-5" />
      </div>
    );
  if (!authed) return <Login onSuccess={load} />;

  const otherSys: SystemView = {
    id: OTHER_ID,
    name: "Other bundles",
    tab: "Other",
    description:
      "Bundles that no registered system claims, by file name or by contents. Their install.sh or deploy.sh runs without answers. If it asks questions, register it as a system.",
  };
  const tabs = unclaimed > 0 || view === OTHER_ID ? [...systems, otherSys] : systems;
  const nav = [{ id: UPLOAD, label: "Upload" }, ...tabs.map((x) => ({ id: x.id, label: x.tab })), { id: HISTORY, label: "History" }];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center gap-6 px-6">
          <div className="flex items-center gap-2.5">
            <Mark className="size-6" />
            <span className="text-[15px] font-semibold tracking-tight">Installer</span>
          </div>

          <nav className="flex min-w-0 gap-0.5 overflow-x-auto rounded-[10px] bg-raised p-1" aria-label="Main">
            {nav.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  setView(n.id);
                  history.replaceState(null, "", "#" + n.id);
                }}
                aria-current={view === n.id ? "page" : undefined}
                className={cn(
                  "h-7 shrink-0 cursor-pointer whitespace-nowrap rounded-[7px] px-3 text-[13px] font-medium transition-colors duration-150",
                  view === n.id ? "bg-fg text-bg" : "text-muted hover:text-fg",
                )}
              >
                {n.label}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-4 text-[12px]">
            <div className="hidden items-center gap-2 sm:flex">
              <span className="size-1.5 rounded-full bg-ok" aria-hidden />
              <span className="max-w-[110px] truncate font-medium">{host?.hostname || "this VM"}</span>
              {host?.ip && <span className="hidden font-mono text-faint xl:inline">{host.ip}</span>}
            </div>
            <button
              aria-label="Sign out"
              title="Sign out"
              onClick={async () => {
                await api("/api/auth/logout", { method: "POST" });
                setAuthed(false);
              }}
              className="cursor-pointer text-muted hover:text-fg"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1120px] px-6 pt-14 pb-24">
        {tabs.map(
          (sys) =>
            view === sys.id && (
              <div key={sys.id} className="space-y-20">
                <DeployView host={host} sys={sys} />
                <ManageView sys={sys} />
              </div>
            ),
        )}
        {view === UPLOAD && (
          <UploadView
            goTo={(id) => {
              setView(id);
              history.replaceState(null, "", "#" + id);
              window.scrollTo({ top: 0 });
            }}
          />
        )}
        {view === HISTORY && <HistoryView openJob={openJob} setOpenJob={setOpenJob} />}
      </main>

      <footer className="mx-auto max-w-[1120px] border-t border-line px-6 py-6 font-mono text-[11px] text-faint">
        installer v{host?.version} · {host?.os ?? "linux"}
        {host?.docker ? ` · docker ${host.docker}` : ""}
      </footer>
    </div>
  );
}
