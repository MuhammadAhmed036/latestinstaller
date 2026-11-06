"use client";

import { Check, FileArchive, FileText, RotateCw, Trash2, UploadCloud, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmtSize } from "@/lib/client";
import { Badge, Button, Modal, PageTitle, Panel, SectionLabel, Spinner, cn } from "./ui";

const CHUNK = 8 * 1024 * 1024; // stays under the server's 10 MB chunk limit
const ALLOWED = /\.(tar\.gz|tgz|tar\.xz|txz|tar\.bz2|tbz2|tar|sha256|sha256sum|sha512|sha)$/i;

type Status = "checking" | "queued" | "exists" | "uploading" | "done" | "failed" | "cancelled";
type Item = {
  id: number;
  file: File;
  status: Status;
  sent: number; // bytes already safe on the VM
  live: number; // bytes of the chunk currently in flight
  replace: boolean;
  resumedFrom: number;
  error?: string;
  speed?: number;
  landed?: string | null; // which system picked the file up
};
type VmFile = { name: string; size: number; mtime: number; kind: "bundle" | "checksum" | "other"; partial?: boolean };

let seq = 0;
const isChecksum = (n: string) => /\.(sha256|sha256sum|sha512|sha)$/i.test(n);

function fmtEta(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return "";
  if (sec < 60) return `${Math.ceil(sec)}s left`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.ceil(sec % 60)}s left`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m left`;
}
const fmtSpeed = (bps: number) => (bps > 0 ? `${(bps / 1048576).toFixed(1)} MB/s` : "");

/** One chunk over XHR so the browser reports progress inside the chunk. */
function sendChunk(url: string, blob: Blob, onProgress: (loaded: number) => void, abort: { current: XMLHttpRequest | null }): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    abort.current = xhr;
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON error page */
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new Error("network"));
    xhr.onabort = () => reject(new Error("aborted"));
    xhr.send(blob);
  });
}

export function UploadView({ goTo }: { goTo: (viewId: string) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [drag, setDrag] = useState(false);
  const [vm, setVm] = useState<{ dir: string; files: VmFile[] } | null>(null);
  const [confirmDel, setConfirmDel] = useState<VmFile | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const itemsRef = useRef<Item[]>([]);
  const cancelFlags = useRef<Set<number>>(new Set());
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const started = useRef(0);
  const lastPaint = useRef(0);

  const patch = useCallback((id: number, p: Partial<Item>) => {
    itemsRef.current = itemsRef.current.map((it) => (it.id === id ? { ...it, ...p } : it));
    setItems(itemsRef.current);
  }, []);

  const refreshVm = useCallback(() => {
    api<{ dir: string; files: VmFile[] }>("/api/upload/files").then(setVm).catch(() => {});
  }, []);
  useEffect(refreshVm, [refreshVm]);

  useEffect(() => {
    if (!running) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [running]);

  async function addFiles(list: FileList | File[]) {
    const incoming = [...list].filter((f) => f.size > 0);
    const rejected = [...list].filter((f) => f.size === 0 || !ALLOWED.test(f.name));
    const ok = incoming.filter((f) => ALLOWED.test(f.name) && !itemsRef.current.some((i) => i.file.name === f.name && i.status !== "done"));
    setNotes(rejected.map((f) => `${f.name}: ${f.size === 0 ? "empty file" : "not a .tar bundle or .sha256 file"}, skipped`));
    const fresh: Item[] = ok.map((file) => ({ id: ++seq, file, status: "checking", sent: 0, live: 0, replace: false, resumedFrom: 0 }));
    itemsRef.current = [...itemsRef.current, ...fresh];
    setItems(itemsRef.current);
    for (const it of fresh) {
      try {
        const r = await api<{ exists: number | null; partial: number }>(`/api/upload?name=${encodeURIComponent(it.file.name)}`);
        if (r.exists !== null && r.exists === it.file.size) patch(it.id, { status: "exists" });
        else if (r.exists !== null) patch(it.id, { status: "queued", replace: true });
        else patch(it.id, { status: "queued", sent: r.partial < it.file.size ? r.partial : 0, resumedFrom: r.partial < it.file.size ? r.partial : 0 });
      } catch (e) {
        patch(it.id, { status: "failed", error: (e as Error).message });
      }
    }
  }

  async function uploadOne(it: Item) {
    const name = encodeURIComponent(it.file.name);
    const total = it.file.size;
    let offset = it.sent;
    let retries = 0;
    patch(it.id, { status: "uploading", error: undefined });
    started.current = Date.now();
    const t0 = Date.now();
    const base = offset;

    while (offset < total) {
      if (cancelFlags.current.has(it.id)) throw new Error("cancelled");
      const blob = it.file.slice(offset, Math.min(offset + CHUNK, total));
      const url = `/api/upload?name=${name}&offset=${offset}&total=${total}${it.replace && offset === 0 ? "&overwrite=1" : ""}`;
      try {
        const res = await sendChunk(
          url,
          blob,
          (loaded) => {
            const now = performance.now();
            if (now - lastPaint.current < 120) return;
            lastPaint.current = now;
            const secs = (Date.now() - t0) / 1000;
            patch(it.id, { live: loaded, speed: secs > 0.5 ? (offset - base + loaded) / secs : undefined });
          },
          xhrRef,
        );
        if (res.status === 409 && res.body.error === "offset") {
          offset = Number(res.body.received) || 0;
          patch(it.id, { sent: offset, live: 0 });
          continue;
        }
        if (res.status === 409 && res.body.error === "exists") {
          patch(it.id, { status: "exists", live: 0 });
          return;
        }
        if (res.status >= 400) throw Object.assign(new Error(String(res.body.error ?? `Server error ${res.status}`)), { fatal: res.status < 500 });
        offset = Number(res.body.received);
        retries = 0;
        patch(it.id, { sent: offset, live: 0 });
      } catch (e) {
        const err = e as Error & { fatal?: boolean };
        if (err.message === "aborted" || cancelFlags.current.has(it.id)) throw new Error("cancelled");
        if (err.fatal || ++retries > 6) throw err;
        // connection hiccup: wait, then ask the VM how much it really has and carry on from there
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** retries, 15_000)));
        try {
          const r = await api<{ partial: number }>(`/api/upload?name=${name}`);
          offset = r.partial;
          patch(it.id, { sent: offset, live: 0, error: `Connection lost, resuming (${retries}/6)` });
        } catch {
          /* still offline: loop retries */
        }
      }
    }
    patch(it.id, { status: "done", sent: total, live: 0, error: undefined, speed: undefined });
  }

  async function start() {
    if (running) return;
    setRunning(true);
    cancelFlags.current.clear();
    for (const it of itemsRef.current.filter((i) => i.status === "queued" || i.status === "failed")) {
      try {
        await uploadOne(itemsRef.current.find((x) => x.id === it.id)!);
      } catch (e) {
        const msg = (e as Error).message;
        patch(it.id, { status: msg === "cancelled" ? "cancelled" : "failed", error: msg === "cancelled" ? undefined : msg, live: 0, speed: undefined });
      }
    }
    setRunning(false);
    refreshVm();
    // tell the operator where each file ended up
    try {
      const r = await api<{ packages: { file: string; system: { name: string } | null }[] }>("/api/packages");
      for (const it of itemsRef.current.filter((i) => i.status === "done" && !isChecksum(i.file.name))) {
        const p = r.packages.find((x) => x.file === it.file.name);
        patch(it.id, { landed: p?.system?.name ?? null });
      }
    } catch {
      /* optional */
    }
  }

  function cancel(it: Item) {
    cancelFlags.current.add(it.id);
    if (it.status === "uploading") xhrRef.current?.abort();
    else patch(it.id, { status: "cancelled" });
  }

  function remove(it: Item) {
    itemsRef.current = itemsRef.current.filter((x) => x.id !== it.id);
    setItems(itemsRef.current);
  }

  const active = items.filter((i) => i.status !== "exists" && i.status !== "cancelled");
  const totalBytes = active.reduce((s, i) => s + i.file.size, 0);
  const doneBytes = active.reduce((s, i) => s + (i.status === "done" ? i.file.size : i.sent + i.live), 0);
  const overall = totalBytes ? Math.min(100, (doneBytes / totalBytes) * 100) : 0;
  const speed = items.find((i) => i.status === "uploading")?.speed ?? 0;
  const eta = speed > 0 ? (totalBytes - doneBytes) / speed : 0;
  const pending = items.filter((i) => i.status === "queued" || i.status === "failed").length;
  const finished = items.filter((i) => i.status === "done").length;

  return (
    <div className="space-y-16">
      <PageTitle title="Upload bundles.">
        Send your <span className="font-mono text-[14px] text-fg">.tar</span> bundles (and optional <span className="font-mono text-[14px] text-fg">.sha256</span> files) from this computer straight to the VM. Big files go in chunks and carry on where they stopped if the connection drops.
      </PageTitle>

      {/* 01 */}
      <section>
        <div className="mb-4 flex items-center justify-between gap-4">
          <SectionLabel n="01">Choose files</SectionLabel>
          <span className="hidden font-mono text-[11px] text-faint sm:block">to {vm?.dir ?? "…"}</span>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
          }}
          className={cn(
            "rounded-panel border border-dashed px-6 py-10 text-center transition-colors duration-150",
            drag ? "border-accent bg-accent-soft" : "border-line-strong bg-surface",
          )}
        >
          <UploadCloud className="mx-auto size-7 text-muted" />
          <p className="mt-3 text-[15px] font-semibold tracking-tight">Drop files here</p>
          <p className="mt-1 text-[13px] text-muted">or pick as many bundles and checksum files as you like in one go</p>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Button className="mt-5" onClick={() => input.current?.click()}>
            Choose files
          </Button>
        </div>

        {notes.length > 0 && (
          <ul className="mt-3 space-y-1 text-[12.5px] text-warn">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </section>

      {/* 02 */}
      {items.length > 0 && (
        <section>
          <div className="mb-4 flex items-center justify-between gap-4">
            <SectionLabel n="02">Upload</SectionLabel>
            {items.some((i) => i.status === "done" || i.status === "cancelled" || i.status === "exists") && !running && (
              <button
                onClick={() => {
                  itemsRef.current = itemsRef.current.filter((i) => !["done", "cancelled", "exists"].includes(i.status));
                  setItems(itemsRef.current);
                }}
                className="cursor-pointer text-[12px] text-muted underline underline-offset-4 hover:text-fg"
              >
                Clear finished
              </button>
            )}
          </div>

          <Panel className="mb-4 px-5 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
              <span className="font-medium">
                {finished} of {active.length} file{active.length === 1 ? "" : "s"} done
              </span>
              <span className="font-mono text-[12px] text-muted tabular-nums">
                {fmtSize(doneBytes)} / {fmtSize(totalBytes)} · {overall.toFixed(0)}%{speed > 0 ? ` · ${fmtSpeed(speed)}` : ""}
                {eta > 0 ? ` · ${fmtEta(eta)}` : ""}
              </span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line-strong">
              <div className={cn("h-full rounded-full transition-[width] duration-200", overall >= 100 ? "bg-ok" : "bg-accent")} style={{ width: `${overall}%` }} />
            </div>
          </Panel>

          <div className="overflow-hidden rounded-panel border border-line">
            {items.map((it) => {
              const pct = it.status === "done" ? 100 : Math.min(100, ((it.sent + it.live) / it.file.size) * 100);
              const csum = isChecksum(it.file.name);
              return (
                <div key={it.id} className="border-b border-line px-5 py-4 last:border-b-0">
                  <div className="flex items-center gap-4">
                    {csum ? <FileText className="size-5 shrink-0 text-faint" /> : <FileArchive className="size-5 shrink-0 text-muted" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[13px]" title={it.file.name}>
                        {it.file.name}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                        <span>{fmtSize(it.file.size)}</span>
                        {it.status === "uploading" && (
                          <span className="font-mono tabular-nums">
                            {fmtSize(it.sent + it.live)} sent{it.speed ? ` · ${fmtSpeed(it.speed)}` : ""}
                          </span>
                        )}
                        {it.status === "queued" && it.resumedFrom > 0 && <span className="text-accent">resumes from {fmtSize(it.resumedFrom)}</span>}
                        {it.status === "queued" && it.replace && <span className="text-warn">replaces the file already on the VM</span>}
                        {it.status === "exists" && <span className="text-warn">already on the VM with the same size</span>}
                        {it.error && <span className={it.status === "failed" ? "text-danger" : "text-warn"}>{it.error}</span>}
                        {it.status === "done" && !csum && it.landed !== undefined && (
                          <span>
                            {it.landed ? (
                              <>
                                recognised as <span className="text-fg">{it.landed}</span>
                              </>
                            ) : (
                              "not recognised yet: choose it from the system tab"
                            )}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {it.status === "checking" && <Spinner className="size-4 text-muted" />}
                      {it.status === "queued" && <Badge>queued</Badge>}
                      {it.status === "uploading" && <Badge tone="accent">{pct.toFixed(0)}%</Badge>}
                      {it.status === "done" && (
                        <Badge tone="ok" icon={<Check className="size-3" />}>
                          uploaded
                        </Badge>
                      )}
                      {it.status === "failed" && <Badge tone="danger">failed</Badge>}
                      {it.status === "cancelled" && <Badge>cancelled</Badge>}
                      {it.status === "exists" && (
                        <Button
                          className="h-7 px-2.5 text-[12px]"
                          onClick={() => patch(it.id, { status: "queued", replace: true })}
                        >
                          Replace
                        </Button>
                      )}
                      {it.status === "failed" && (
                        <Button className="h-7 px-2.5 text-[12px]" icon={<RotateCw className="size-3" />} disabled={running} onClick={() => patch(it.id, { status: "queued" })}>
                          Retry
                        </Button>
                      )}
                      {(it.status === "uploading" || (running && it.status === "queued")) && (
                        <button aria-label="Cancel" onClick={() => cancel(it)} className="cursor-pointer text-muted hover:text-fg">
                          <X className="size-4" />
                        </button>
                      )}
                      {!running && ["queued", "failed", "exists", "cancelled", "done"].includes(it.status) && (
                        <button aria-label="Remove from list" onClick={() => remove(it)} className="cursor-pointer text-faint hover:text-fg">
                          <X className="size-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {(it.status === "uploading" || it.status === "done" || (it.status === "failed" && it.sent > 0) || (it.status === "queued" && it.sent > 0)) && (
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line-strong">
                      <div
                        className={cn("h-full rounded-full transition-[width] duration-150", it.status === "done" ? "bg-ok" : it.status === "failed" ? "bg-danger" : "bg-accent")}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {(pending > 0 || running) && (
            <Button variant="primary" className="h-10 px-5" loading={running} disabled={pending === 0 || running} onClick={start} icon={<UploadCloud className="size-4" />}>
              {running ? "Uploading…" : `Upload ${pending} file${pending === 1 ? "" : "s"}`}
            </Button>
            )}
            {running && <span className="text-[12.5px] text-muted">Keep this page open until it finishes.</span>}
            {!running && finished > 0 && pending === 0 && (
              <span className="text-[13px] text-ok">All done. Open a system tab to deploy.</span>
            )}
          </div>

          {!running &&
            [...new Set(items.filter((i) => i.status === "done" && i.landed).map((i) => i.landed!))].length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                <TabLinks items={items} goTo={goTo} />
              </div>
            )}
        </section>
      )}

      {/* 03 */}
      <section>
        <div className="mb-4 flex items-center justify-between gap-4">
          <SectionLabel n={items.length ? "03" : "02"}>Files on the VM</SectionLabel>
          <button onClick={refreshVm} className="cursor-pointer text-[12px] text-muted underline underline-offset-4 hover:text-fg">
            Refresh
          </button>
        </div>
        {!vm ? (
          <div className="h-24 animate-pulse rounded-panel bg-surface" />
        ) : vm.files.length === 0 ? (
          <Panel className="border-dashed px-6 py-10 text-center text-[13px] text-faint">The packages folder is empty.</Panel>
        ) : (
          <div className="overflow-hidden rounded-panel border border-line">
            {vm.files.map((f) => (
              <div key={f.name + (f.partial ? ".part" : "")} className="flex items-center gap-4 border-b border-line px-5 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[12.5px]" title={f.name}>
                    {f.name}
                  </div>
                  <div className="text-[12px] text-faint">
                    {fmtSize(f.size)} · {new Date(f.mtime).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                {f.partial && <Badge tone="warn">unfinished upload</Badge>}
                {f.kind === "checksum" && <Badge>checksum</Badge>}
                <button aria-label={`Delete ${f.name}`} onClick={() => setConfirmDel(f)} className="cursor-pointer text-faint hover:text-danger">
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <Modal
        open={!!confirmDel}
        title="Delete this file from the VM?"
        onClose={() => setConfirmDel(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDel(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirmDel) return;
                await api(`/api/upload?name=${encodeURIComponent(confirmDel.name)}${confirmDel.partial ? "&part=1" : ""}`, { method: "DELETE" }).catch(() => {});
                setConfirmDel(null);
                refreshVm();
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="font-mono text-[12px] break-all text-fg">{confirmDel?.name}</p>
        <p className="mt-2">Systems that are already installed are not affected. You can upload the file again at any time.</p>
      </Modal>
    </div>
  );
}

/** Buttons that jump to the tab each uploaded bundle belongs to. */
function TabLinks({ items, goTo }: { items: Item[]; goTo: (viewId: string) => void }) {
  const [map, setMap] = useState<{ name: string; id: string }[]>([]);
  useEffect(() => {
    api<{ packages: { file: string; system: { id: string; name: string } | null }[] }>("/api/packages")
      .then((r) => {
        const names = new Set(items.filter((i) => i.status === "done").map((i) => i.file.name));
        const seen = new Map<string, string>();
        for (const p of r.packages) if (names.has(p.file) && p.system) seen.set(p.system.id, p.system.name);
        setMap([...seen].map(([id, name]) => ({ id, name })));
      })
      .catch(() => {});
  }, [items]);
  return (
    <>
      {map.map((m) => (
        <Button key={m.id} onClick={() => goTo(m.id)}>
          Open {m.name}
        </Button>
      ))}
    </>
  );
}
