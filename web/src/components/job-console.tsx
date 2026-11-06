"use client";

import { Check, Copy, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, fmtDuration, type JobView } from "@/lib/client";
import { Badge, Panel, Spinner, cn } from "./ui";

export function useJob(id: string | null) {
  const [job, setJob] = useState<JobView | null>(null);
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    setJob(null);
    setLines([]);
    if (!id) return;
    let stop = false;
    let from = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await api<{ job: JobView; lines: string[]; next: number }>(`/api/jobs/${id}?from=${from}`);
        if (stop) return;
        from = r.next;
        setJob(r.job);
        if (r.lines.length) setLines((l) => [...l, ...r.lines]);
        if (r.job.status === "running") timer = setTimeout(tick, 700);
      } catch {
        if (!stop) timer = setTimeout(tick, 2000);
      }
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id]);

  return { job, lines };
}

/** Segmented progress: one bar per step with its label underneath. */
function Steps({ steps }: { steps: JobView["steps"] }) {
  if (steps.length < 2) return null;
  return (
    <ol className="grid gap-2 border-b border-line px-5 py-4" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((s, i) => (
        <li key={s.key} className="min-w-0">
          <div
            className={cn(
              "h-[3px] rounded-full",
              s.state === "done" && "bg-fg",
              s.state === "active" && "animate-pulse bg-accent",
              s.state === "failed" && "bg-danger",
              s.state === "pending" && "bg-line-strong",
            )}
          />
          <div
            className={cn(
              "mt-2 truncate font-mono text-[10.5px] tracking-wider uppercase",
              s.state === "pending" ? "text-faint" : s.state === "failed" ? "text-danger" : s.state === "active" ? "text-[#8da6ff]" : "text-muted",
            )}
          >
            {String(i + 1).padStart(2, "0")} {s.label}
          </div>
        </li>
      ))}
    </ol>
  );
}

function lineClass(l: string): string {
  if (l.startsWith("──")) return "mt-4 font-semibold text-fg first:mt-0";
  if (/^\s*(✖|ERROR|error:|fatal)/i.test(l)) return "text-danger";
  if (l.startsWith("✔") || /checksum ok/i.test(l)) return "text-ok";
  if (/^\s*(warn|warning)/i.test(l)) return "text-warn";
  if (l.startsWith("$ ")) return "text-[#8da6ff]";
  return "text-muted";
}

export function JobConsole({ id, onDone, className }: { id: string; onDone?: () => void; className?: string }) {
  const { job, lines } = useJob(id);
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [copied, setCopied] = useState(false);
  const [, force] = useState(0);
  const doneFor = useRef<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  useEffect(() => {
    if (job && job.status !== "running" && doneFor.current !== job.id) {
      doneFor.current = job.id;
      onDone?.();
    }
  }, [job, onDone]);

  useEffect(() => {
    if (job?.status !== "running") return;
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [job?.status]);

  const status = job?.status ?? "running";
  return (
    <Panel className={cn("overflow-hidden", className)}>
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold tracking-tight">{job?.title ?? "Starting…"}</div>
          {job?.subtitle && <div className="truncate font-mono text-[11.5px] text-faint">{job.subtitle}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {job && <span className="font-mono text-[12px] text-muted tabular-nums">{fmtDuration(job.startedAt, job.endedAt)}</span>}
          {status === "running" && <Badge tone="accent" icon={<Spinner className="size-3" />}>Running</Badge>}
          {status === "success" && <Badge tone="ok" icon={<Check className="size-3" />}>Success</Badge>}
          {status === "failed" && <Badge tone="danger" icon={<X className="size-3" />}>Failed</Badge>}
          <button
            aria-label="Copy log"
            onClick={() => {
              navigator.clipboard?.writeText(lines.join("\n"));
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            }}
            className="cursor-pointer text-muted hover:text-fg"
          >
            {copied ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
          </button>
        </div>
      </div>
      {job && <Steps steps={job.steps} />}
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="h-[380px] overflow-auto bg-bg px-5 py-4 font-mono text-[12.5px] leading-[1.7] whitespace-pre-wrap break-all"
        role="log"
        aria-live="polite"
      >
        {lines.length === 0 && <span className="text-faint">Waiting for output…</span>}
        {lines.map((l, i) => (
          <div key={i} className={lineClass(l)}>
            {l || " "}
          </div>
        ))}
      </div>
    </Panel>
  );
}
