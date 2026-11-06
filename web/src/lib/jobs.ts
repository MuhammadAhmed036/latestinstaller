import fs from "node:fs";
import path from "node:path";
import { LOGS_DIR } from "./config";
import { spawnHost } from "./host";

export type StepState = "pending" | "active" | "done" | "failed";
export type Job = {
  id: string;
  kind: "deploy" | "manage" | "env";
  title: string;
  subtitle?: string;
  status: "running" | "success" | "failed";
  steps: { key: string; label: string; state: StepState }[];
  startedAt: number;
  endedAt?: number;
  exitCode?: number;
};
type Live = Job & { lines: string[] };

const g = globalThis as unknown as { __jobs?: Map<string, Live> };
const jobs = (g.__jobs ??= new Map<string, Live>());

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

function ensureDir() {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}
const logPath = (id: string) => path.join(LOGS_DIR, `${id}.log`);
const metaPath = (id: string) => path.join(LOGS_DIR, `${id}.json`);

function publicJob(j: Live): Job {
  const { lines, ...rest } = j;
  void lines;
  return rest;
}

function saveMeta(j: Live) {
  try {
    fs.writeFileSync(metaPath(j.id), JSON.stringify(publicJob(j)));
  } catch {
    /* ignore */
  }
}

export function startJob(opts: {
  kind: Job["kind"];
  title: string;
  subtitle?: string;
  steps: { key: string; label: string }[];
  script: string;
}): Job {
  ensureDir();
  const id = `${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
  const job: Live = {
    id,
    kind: opts.kind,
    title: opts.title,
    subtitle: opts.subtitle,
    status: "running",
    steps: opts.steps.map((s) => ({ ...s, state: "pending" as StepState })),
    startedAt: Date.now(),
    lines: [],
  };
  jobs.set(id, job);
  saveMeta(job);

  const append = (raw: string) => {
    let line = raw;
    const m = /^::step::(\w+)/.exec(line);
    if (m) {
      let seen = false;
      for (const s of job.steps) {
        if (s.key === m[1]) {
          s.state = "active";
          seen = true;
        } else if (!seen && s.state !== "failed") s.state = "done";
      }
      line = `── ${job.steps.find((s) => s.key === m[1])?.label ?? m[1]}`;
    }
    line = line.replace(ANSI, "");
    job.lines.push(line);
    try {
      fs.appendFileSync(logPath(id), line + "\n");
    } catch {
      /* ignore */
    }
  };

  spawnHost(opts.script, append).then((code) => {
    job.exitCode = code;
    job.endedAt = Date.now();
    job.status = code === 0 ? "success" : "failed";
    for (const s of job.steps) {
      if (code === 0) s.state = "done";
      else if (s.state === "active") s.state = "failed";
    }
    append(code === 0 ? `\n✔ Finished OK in ${((job.endedAt - job.startedAt) / 1000).toFixed(1)}s` : `\n✖ Failed with exit code ${code}`);
    saveMeta(job);
  });

  return publicJob(job);
}

export function readJob(id: string, from = 0): { job: Job; lines: string[]; next: number } | null {
  if (!/^[\w-]+$/.test(id)) return null;
  const live = jobs.get(id);
  if (live) return { job: publicJob(live), lines: live.lines.slice(from), next: live.lines.length };
  try {
    const job = JSON.parse(fs.readFileSync(metaPath(id), "utf8")) as Job;
    const all = fs.existsSync(logPath(id)) ? fs.readFileSync(logPath(id), "utf8").split("\n") : [];
    if (all.at(-1) === "") all.pop();
    if (job.status === "running") {
      // Left over from a container restart – it can no longer be running.
      job.status = "failed";
      job.steps = job.steps.map((s) => (s.state === "active" ? { ...s, state: "failed" } : s));
    }
    return { job, lines: all.slice(from), next: all.length };
  } catch {
    return null;
  }
}

export function listJobs(limit = 30): Job[] {
  try {
    const out: Job[] = [];
    for (const f of fs.readdirSync(LOGS_DIR)) {
      if (!f.endsWith(".json")) continue;
      const live = jobs.get(f.slice(0, -5));
      if (live) {
        out.push(publicJob(live));
        continue;
      }
      try {
        const j = JSON.parse(fs.readFileSync(path.join(LOGS_DIR, f), "utf8")) as Job;
        if (j.status === "running") j.status = "failed";
        out.push(j);
      } catch {
        /* skip */
      }
    }
    return out.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
  } catch {
    return [];
  }
}

export function hasRunningJob(): boolean {
  for (const j of jobs.values()) if (j.status === "running") return true;
  return false;
}
