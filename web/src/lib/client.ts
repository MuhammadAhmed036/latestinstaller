export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.json !== undefined ? { "content-type": "application/json" } : {}), ...init?.headers },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export function fmtSize(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function relTime(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function fmtDuration(a: number, b?: number): string {
  const s = Math.round(((b ?? Date.now()) - a) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

export type PkgView = {
  file: string;
  size: number;
  mtime: number;
  sidecar: string | null;
  expectedSha: string | null;
  parsed: { name: string; version: string; commit: string; mode: string; date: string | null; flag: string | null } | null;
  system: { id: string; name: string } | null;
  detecting?: boolean;
  manual?: boolean;
};

export type JobView = {
  id: string;
  kind: string;
  title: string;
  subtitle?: string;
  status: "running" | "success" | "failed";
  steps: { key: string; label: string; state: "pending" | "active" | "done" | "failed" }[];
  startedAt: number;
  endedAt?: number;
  exitCode?: number;
};

/** Pseudo-system for bundles no registered system claims. */
export const OTHER_ID = "__other";

export type FieldView = {
  key: string;
  label: string;
  kind: "text" | "port" | "password" | "select";
  options?: { value: string; label: string; hint?: string }[];
  when?: { key: string; in?: string[]; notEmpty?: boolean }[];
  skipIfEnv?: string;
  skipIfFile?: string;
  skipNote?: string;
  hint?: string;
  pattern?: string;
  patternMsg?: string;
  optional?: boolean;
  wide?: boolean;
  placeholder?: string;
};

export type SystemView = {
  id: string;
  name: string;
  tab: string;
  description: string;
  installDir?: string;
  ctl?: string;
  envFile?: string;
  envUpdateCmd?: string;
  fields?: FieldView[];
  loginHint?: { title: string; lines: string[]; command?: string };
  ctlCommands?: { cmd: string; label: string; hint: string; danger?: boolean }[];
};
