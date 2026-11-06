"use client";

import { AlertTriangle, ArrowRight, ChevronDown, FileArchive, KeyRound, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { OTHER_ID, api, fmtSize, relTime, type PkgView, type SystemView } from "@/lib/client";
import type { HostInfo } from "./shell";
import { ConfigForm } from "./config-form";
import { isVisible } from "@/lib/fields";
import { JobConsole } from "./job-console";
import { Badge, Button, CommandBlock, Modal, PageTitle, Panel, SectionLabel, Toggle, cn } from "./ui";

type Scan = { dir: string; exists: boolean; packages: PkgView[] };
type Inspect = { entries: string[]; top: string | null; entryScript: string | null; error?: string };
type CheckState = "ok" | "warn" | "fail" | "loading" | "skip";

const LS_PREFIX = "ivi.activeDeploy.";
const COLS = "grid-cols-[20px_minmax(0,1fr)_auto] md:grid-cols-[20px_minmax(0,1fr)_72px_84px_130px_96px]";

const TAG: Record<CheckState, { text: string; cls: string }> = {
  ok: { text: "Pass", cls: "text-ok" },
  warn: { text: "Warn", cls: "text-warn" },
  fail: { text: "Fail", cls: "text-danger" },
  loading: { text: "…", cls: "text-faint" },
  skip: { text: "Skip", cls: "text-faint" },
};

function LoginHint({ hint }: { hint: NonNullable<SystemView["loginHint"]> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="-mt-8 rounded-ctl border border-line bg-surface">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left text-[13px] text-fg"
      >
        <span className="flex items-center gap-2"><KeyRound className="size-4 text-accent" /> {hint.title}</span>
        <ChevronDown className={cn("size-4 text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-line px-4 py-4 text-[13px] text-muted">
          {hint.lines.map((l, i) => <p key={i}>{l}</p>)}
          {hint.command && <CommandBlock text={hint.command}>{hint.command}</CommandBlock>}
        </div>
      )}
    </div>
  );
}

export function DeployView({ host, sys }: { host: HostInfo | null; sys: SystemView }) {
  const LS_KEY = LS_PREFIX + sys.id;
  const hasForm = !!sys.fields?.length;
  const [values, setValues] = useState<Record<string, string>>({});
  const [existing, setExisting] = useState(false);
  const [formOk, setFormOk] = useState(!hasForm);
  const [scan, setScan] = useState<Scan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [unclaimed, setUnclaimed] = useState<PkgView[]>([]);
  const [showOthers, setShowOthers] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const [verify, setVerify] = useState(true);
  const [cleanup, setCleanup] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const autoPicked = useRef(false);

  const rescan = useCallback(async () => {
    setScanning(true);
    try {
      const all = await api<Scan>("/api/packages");
      const s = { ...all, packages: all.packages.filter((p) => (sys.id === OTHER_ID ? !p.system : p.system?.id === sys.id)) };
      setScan(s);
      setUnclaimed(all.packages.filter((p) => !p.system));
      setSelected((cur) => {
        if (cur && s.packages.some((p) => p.file === cur)) return cur;
        if (s.packages.length === 1 && !autoPicked.current) {
          autoPicked.current = true;
          return s.packages[0].file;
        }
        return null;
      });
    } catch {
      /* keep previous */
    } finally {
      setScanning(false);
    }
  }, [sys.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    rescan();
    const t = setInterval(rescan, 10_000);
    return () => clearInterval(t);
  }, [rescan]);

  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      setJobId(saved);
      setRunning(true);
    }
  }, []);

  const pkg = scan?.packages.find((p) => p.file === selected) ?? null;
  // With nothing recognised for this system but other files present, show them straight away.
  const othersOpen = showOthers || (scan?.packages.length === 0 && unclaimed.length > 0);

  useEffect(() => {
    setInspect(null);
    if (!pkg) return;
    setVerify(!!pkg.sidecar);
    let stale = false;
    api<Inspect>(`/api/packages/inspect?file=${encodeURIComponent(pkg.file)}`)
      .then((r) => !stale && setInspect(r))
      .catch((e) => !stale && setInspect({ entries: [], top: null, entryScript: null, error: e.message }));
    return () => {
      stale = true;
    };
  }, [pkg?.file, pkg?.sidecar]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    if (!pkg) return;
    setStarting(true);
    setError("");
    try {
      const r = await api<{ job: { id: string } }>("/api/deploy", { method: "POST", json: { file: pkg.file, verify, cleanup, values } });
      localStorage.setItem(LS_KEY, r.job.id);
      setJobId(r.job.id);
      setRunning(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConfirm(false);
      setStarting(false);
    }
  }

  const free = host?.free ? Number(host.free) : NaN;
  const need = pkg ? pkg.size * 3 : 0;
  const checks: { state: CheckState; label: string; detail?: string }[] = pkg
    ? [
        pkg.sidecar
          ? { state: pkg.expectedSha ? "ok" : "warn", label: "Checksum file", detail: pkg.sidecar }
          : { state: "skip", label: "No checksum file", detail: "Not required. Integrity check is skipped" },
        !inspect
          ? { state: "loading", label: "Bundle contents" }
          : inspect.error
            ? { state: "fail", label: "Bundle unreadable", detail: inspect.error }
            : inspect.entryScript
              ? { state: "ok", label: `Entry script  ${inspect.entryScript}`, detail: inspect.top ? `${inspect.top}/` : "archive root" }
              : { state: "fail", label: "No install.sh or deploy.sh", detail: "Cannot be deployed automatically" },
        host?.docker
          ? { state: "ok", label: "Docker", detail: host.docker }
          : { state: "warn", label: "Docker not detected", detail: "The bundle's install.sh must install it" },
        Number.isNaN(free)
          ? { state: "loading", label: "Free disk" }
          : free >= need
            ? { state: "ok", label: "Free disk", detail: `${fmtSize(free)} available, about ${fmtSize(need)} needed` }
            : { state: "fail", label: "Free disk", detail: `${fmtSize(free)} available, about ${fmtSize(need)} needed` },
      ]
    : [];

  const blocked = !pkg || running || !!pkg.detecting || !inspect || checks.some((c) => c.state === "fail") || (hasForm && !formOk);
  const untested = pkg?.parsed?.flag?.toUpperCase() === "UNTESTED";

  return (
    <div className="space-y-16">
      <PageTitle title={sys.name + "."}>
        {sys.description} Put the bundle in the packages folder and it is picked up automatically, whatever it is called. A <span className="font-mono text-[14px] text-fg">.sha256</span> file is optional.
      </PageTitle>

      {sys.loginHint && <LoginHint hint={sys.loginHint} />}

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-ctl border border-danger/40 bg-danger-soft px-4 py-3 text-[13px] text-danger">
          <AlertTriangle className="size-4 shrink-0" /> {error}
        </div>
      )}

      {/* 01 ------------------------------------------------------------ */}
      <section>
        <div className="mb-4 flex items-center justify-between gap-4">
          <SectionLabel n="01">Select bundle</SectionLabel>
          <div className="flex items-center gap-3">
            <span className="hidden font-mono text-[11px] text-faint sm:block">{scan?.dir}</span>
            <button
              onClick={rescan}
              className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-[12px] text-muted hover:text-fg"
            >
              <RefreshCw className={cn("size-3", scanning && "animate-spin")} /> Rescan
            </button>
          </div>
        </div>

        {!scan ? (
          <div className="h-28 animate-pulse rounded-panel border border-line bg-surface" />
        ) : scan.packages.length === 0 ? (
          <Panel className="border-dashed px-6 py-14 text-center">
            <FileArchive className="mx-auto size-6 text-faint" />
            <h3 className="mt-4 text-[16px] font-semibold tracking-tight">{scan.exists ? "No bundles found" : "Packages folder not found"}</h3>
            <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-muted">Copy the bundle into the packages folder (a checksum file is optional). This list refreshes every 10 seconds.</p>
            <div className="mx-auto mt-6 max-w-xl text-left">
              <CommandBlock text={`scp bundle.tar.gz bundle.tar.gz.sha256 user@${host?.ip || "vm-ip"}:${scan.dir}/`}>
                scp bundle.tar.gz bundle.tar.gz.sha256 user@{host?.ip || "vm-ip"}:{scan.dir}/
              </CommandBlock>
            </div>
          </Panel>
        ) : (
          <div role="radiogroup" aria-label="Bundles" className="overflow-hidden rounded-panel border border-line">
            <div className={cn("grid items-center gap-4 border-b border-line bg-surface px-5 py-2.5 font-mono text-[10.5px] tracking-[0.12em] text-faint uppercase", COLS)}>
              <span />
              <span>Bundle</span>
              <span className="hidden md:block">Version</span>
              <span className="hidden md:block">Size</span>
              <span className="hidden md:block">Checksum</span>
              <span className="hidden text-right md:block">Added</span>
            </div>
            {scan.packages.map((p) => {
              const on = p.file === selected;
              return (
                <button
                  key={p.file}
                  role="radio"
                  aria-checked={on}
                  onClick={() => setSelected(p.file)}
                  className={cn(
                    "relative grid w-full cursor-pointer items-center gap-4 border-b border-line px-5 py-4 text-left transition-colors duration-150 last:border-b-0",
                    COLS,
                    on ? "bg-raised" : "hover:bg-surface",
                  )}
                >
                  {on && <span className="absolute inset-y-0 left-0 w-[2px] bg-accent" aria-hidden />}
                  <span className={cn("grid size-4 place-items-center rounded-full border", on ? "border-accent" : "border-line-strong")}>
                    {on && <span className="size-2 rounded-full bg-accent" />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold tracking-tight">{p.system?.name ?? p.parsed?.name ?? "Unrecognised bundle"}</span>
                      {p.parsed?.flag && <Badge tone="warn">{p.parsed.flag}</Badge>}
                      {p.parsed && <Badge>{p.parsed.mode}</Badge>}
                      {p.manual && <Badge>assigned by you</Badge>}
                      {p.detecting && <Badge tone="accent">identifying…</Badge>}
                      {!p.system && !p.detecting && <Badge>unrecognised</Badge>}
                    </span>
                    <span className="mt-1 block truncate font-mono text-[11.5px] text-faint" title={p.file}>
                      {p.file}
                    </span>
                  </span>
                  <span className="hidden font-mono text-[12px] md:block">{p.parsed ? `v${p.parsed.version}` : "-"}</span>
                  <span className="hidden font-mono text-[12px] text-muted md:block">{fmtSize(p.size)}</span>
                  <span className={cn("hidden items-center gap-2 font-mono text-[12px] md:flex", p.sidecar ? "text-ok" : "text-faint")}>
                    <span className="size-1.5 rounded-full bg-current" aria-hidden />
                    {p.sidecar ? "SHA-256" : "none"}
                  </span>
                  <span className="hidden text-right text-[12px] text-muted md:block">{relTime(p.mtime)}</span>
                </button>
              );
            })}
          </div>
        )}

        {sys.id !== OTHER_ID && (
          <div className="mt-4">
            <button
              onClick={() => setShowOthers((v) => !v)}
              aria-expanded={othersOpen}
              className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-ctl border border-dashed border-line-strong px-4 py-3 text-left text-[13px] text-muted transition-colors duration-150 hover:border-fg/40 hover:text-fg"
            >
              <span>
                <span className="font-medium text-fg">Your file is not listed?</span> Choose it yourself from the other files on this VM
              </span>
              <span className="flex shrink-0 items-center gap-2 font-mono text-[12px]">
                {unclaimed.length} file{unclaimed.length === 1 ? "" : "s"}
                <ChevronDown className={cn("size-4 transition-transform duration-150", othersOpen && "rotate-180")} />
              </span>
            </button>
            {othersOpen && (
              <div className="mt-3 overflow-hidden rounded-panel border border-line">
                {unclaimed.length === 0 ? (
                  <p className="px-5 py-4 text-[13px] text-faint">No other archives in {scan?.dir}. Copy the file there first.</p>
                ) : (
                  unclaimed.map((p) => (
                    <div key={p.file} className="flex items-center gap-4 border-b border-line px-5 py-3 last:border-b-0">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-[12.5px]" title={p.file}>
                          {p.file}
                        </div>
                        <div className="text-[12px] text-faint">{fmtSize(p.size)} · {p.detecting ? "identifying…" : "not recognised"}</div>
                      </div>
                      <Button
                        className="h-8"
                        loading={assigning === p.file}
                        onClick={async () => {
                          setAssigning(p.file);
                          try {
                            await api("/api/packages/assign", { method: "POST", json: { file: p.file, system: sys.id } });
                            setSelected(p.file);
                            await rescan();
                          } catch (e) {
                            setError((e as Error).message);
                          } finally {
                            setAssigning(null);
                          }
                        }}
                      >
                        Use for {sys.tab}
                      </Button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {hasForm && (
        <section>
          <div className="mb-4 flex items-center justify-between gap-4">
            <SectionLabel n="02">Configure</SectionLabel>
            {existing && <Badge tone="accent">existing install detected, values prefilled</Badge>}
          </div>
          <ConfigForm sys={sys} values={values} setValues={setValues} onValid={setFormOk} existing={existing} setExisting={setExisting} />
        </section>
      )}

      {/* 02 ------------------------------------------------------------ */}
      <section>
        <div className="mb-4">
          <SectionLabel n={hasForm ? "03" : "02"}>Review and deploy</SectionLabel>
        </div>
        {!pkg ? (
          <div className="rounded-panel border border-dashed border-line px-6 py-10 text-center text-[13px] text-faint">Select a bundle above to see its checks.</div>
        ) : (
          <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <ul className="border-t border-line">
              {checks.map((c) => (
                <li key={c.label} className="flex items-start gap-5 border-b border-line py-3.5">
                  <span className={cn("w-9 pt-px font-mono text-[11px] font-medium tracking-wider uppercase", TAG[c.state].cls)}>{TAG[c.state].text}</span>
                  <span className="min-w-0">
                    <span className="block text-[14px] font-medium">{c.label}</span>
                    {c.detail && <span className="block truncate font-mono text-[12px] text-faint">{c.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>

            <div className="space-y-6">
              <div className="space-y-4">
                <Toggle
                  checked={verify}
                  onChange={setVerify}
                  disabled={!pkg.sidecar}
                  label="Verify SHA-256 first"
                  hint={pkg.sidecar ? "Stops if the file is corrupt or incomplete." : "No checksum file found, nothing to verify."}
                />
                <Toggle checked={cleanup} onChange={setCleanup} label="Clean up after install" hint="Deletes extracted files. The bundle itself stays." />
              </div>

              {untested && (
                <div className="flex gap-2.5 text-[13px] text-warn">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>Marked UNTESTED. Deploy only where you can roll back.</span>
                </div>
              )}

              <div>
                <Button variant="primary" className="h-11 w-full text-[14px]" disabled={blocked} onClick={() => setConfirm(true)} icon={<ArrowRight className="size-4" />}>
                  {running ? "Deployment running" : "Deploy"}
                </Button>
                <p className="mt-2.5 text-center text-[12px] text-faint">Runs as root on this VM</p>
                {pkg.manual && (
                  <p className="mt-1 text-center text-[12px] text-faint">
                    Assigned to {sys.tab} by you.{" "}
                    <button
                      className="cursor-pointer text-muted underline underline-offset-2 hover:text-fg"
                      onClick={async () => {
                        await api("/api/packages/assign", { method: "POST", json: { file: pkg.file, system: null } });
                        setSelected(null);
                        rescan();
                      }}
                    >
                      Undo
                    </button>
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 03 ------------------------------------------------------------ */}
      {jobId && (
        <section>
          <div className="mb-4">
            <SectionLabel n={hasForm ? "04" : "03"}>Progress</SectionLabel>
          </div>
          <JobConsole
            id={jobId}
            onDone={() => {
              setRunning(false);
              localStorage.removeItem(LS_KEY);
              rescan();
            }}
          />
        </section>
      )}

      <Modal
        open={confirm}
        title="Deploy this bundle?"
        onClose={() => setConfirm(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={starting} onClick={start}>
              Deploy now
            </Button>
          </>
        }
      >
        <p className="font-mono text-[12px] break-all text-fg">{pkg?.file}</p>
        <p className="mt-3">
          It will be {verify ? "verified, " : ""}extracted, and <span className="font-mono text-fg">{inspect?.entryScript ?? "install.sh"}</span> will run as root on this VM.
        </p>
        {hasForm && (
          <dl className="mt-3 space-y-1 rounded-ctl border border-line bg-bg px-3 py-2.5 font-mono text-[12px]">
            {(sys.fields ?? [])
              .filter((f) => isVisible(f, values) && (values[f.key] || f.kind === "password"))
              .map((f) => (
                <div key={f.key} className="flex justify-between gap-4">
                  <dt className="text-faint">{f.label}</dt>
                  <dd className="min-w-0 truncate text-fg">
                    {f.kind === "password"
                      ? values[f.key]
                        ? "set by you"
                        : existing
                          ? "keep current"
                          : "automatic"
                      : f.kind === "select"
                        ? (f.options?.find((o) => o.value === values[f.key])?.label ?? values[f.key])
                        : values[f.key]}
                  </dd>
                </div>
              ))}
          </dl>
        )}
        {untested && <p className="mt-2 text-warn">This bundle is marked UNTESTED.</p>}
      </Modal>
    </div>
  );
}
