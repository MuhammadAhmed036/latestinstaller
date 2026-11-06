"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { api, fmtDate, fmtDuration, type JobView } from "@/lib/client";
import { JobConsole } from "./job-console";
import { Badge, PageTitle, Panel, SectionLabel, Spinner } from "./ui";

export function HistoryView({ openJob, setOpenJob }: { openJob: string | null; setOpenJob: (id: string | null) => void }) {
  const [jobs, setJobs] = useState<JobView[] | null>(null);

  useEffect(() => {
    const load = () => api<{ jobs: JobView[] }>("/api/jobs").then((r) => setJobs(r.jobs)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="space-y-16">
      <PageTitle title="History.">Every deploy and control command run from this installer, with its full log.</PageTitle>

      <section>
        <div className="mb-4">
          <SectionLabel n="01">Recent jobs</SectionLabel>
        </div>
        {!jobs ? (
          <div className="h-32 animate-pulse rounded-panel bg-surface" />
        ) : jobs.length === 0 ? (
          <Panel className="border-dashed px-6 py-12 text-center text-[13px] text-faint">Nothing has been run yet.</Panel>
        ) : (
          <div className="overflow-hidden rounded-panel border border-line">
            {jobs.map((j) => (
              <button
                key={j.id}
                onClick={() => setOpenJob(openJob === j.id ? null : j.id)}
                aria-expanded={openJob === j.id}
                className="flex w-full cursor-pointer items-center gap-4 border-b border-line px-5 py-3.5 text-left last:border-b-0 hover:bg-surface"
              >
                <ChevronRight className={`size-4 shrink-0 text-faint transition-transform duration-150 ${openJob === j.id ? "rotate-90 text-fg" : ""}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{j.title}</span>
                  <span className="block truncate font-mono text-[11.5px] text-faint">{j.subtitle}</span>
                </span>
                <span className="hidden text-[12px] text-muted sm:block">{fmtDate(j.startedAt)}</span>
                <span className="hidden w-14 text-right font-mono text-[12px] text-muted sm:block">{fmtDuration(j.startedAt, j.endedAt)}</span>
                {j.status === "success" && <Badge tone="ok">Success</Badge>}
                {j.status === "failed" && <Badge tone="danger">Failed</Badge>}
                {j.status === "running" && <Badge tone="accent" icon={<Spinner className="size-3" />}>Running</Badge>}
              </button>
            ))}
          </div>
        )}
      </section>

      {openJob && <JobConsole key={openJob} id={openJob} />}
    </div>
  );
}
