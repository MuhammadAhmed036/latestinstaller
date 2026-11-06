import { randomBytes } from "node:crypto";
import { loadSystems, type Field, type SystemDef } from "./config";
import { isVisible } from "./fields";
import { q, runHost } from "./host";

export function getSystem(id: string | null | undefined): SystemDef | null {
  return loadSystems().find((s) => s.id === id) ?? null;
}

function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  return env;
}

/** The installed system's .env, or null if it is not installed yet. */
export async function readInstalledEnv(sys: SystemDef): Promise<Record<string, string> | null> {
  if (!sys.envFile) return null;
  const r = await runHost(`[ -f ${q(sys.envFile)} ] && cat ${q(sys.envFile)}`, 8000);
  return r.code === 0 ? parseEnv(r.stdout) : null;
}

/** Fields whose question the entry script will not ask (already configured in the installed .env), with the found value. */
export async function skippedFields(sys: SystemDef): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const fields = sys.fields ?? [];
  if (fields.some((f) => f.skipIfEnv)) {
    const env = await readInstalledEnv(sys);
    if (env) {
      for (const f of fields) {
        const v = f.skipIfEnv ? env[f.skipIfEnv] : "";
        if (f.skipIfEnv && v) out[f.key] = v;
      }
    }
  }
  for (const f of fields) {
    if (!f.skipIfFile) continue;
    const r = await runHost(`[ -f ${q(f.skipIfFile)} ]`, 8000);
    if (r.code === 0) out[f.key] = f.skipIfFile;
  }
  return out;
}

/**
 * Turn the posted form values into the ordered stdin lines (and KEY=VALUE pairs for env-file systems).
 * Hidden fields are neither validated nor sent, exactly mirroring which questions the script asks.
 */
export function buildAnswers(
  sys: SystemDef,
  values: Record<string, unknown>,
  skipped: string[] = [],
  installedEnv: Record<string, string> | null = null,
): { answers: string[]; envPairs: [string, string][]; args: string[] } | { error: string } {
  const str: Record<string, string> = {};
  for (const f of sys.fields ?? []) str[f.key] = typeof values[f.key] === "string" ? (values[f.key] as string).trim() : "";
  for (const k of skipped) str[k] = "";

  const out: string[] = [];
  const envPairs: [string, string][] = [];
  const args: string[] = [];
  for (const f of sys.fields ?? []) {
    if (!isVisible(f, str, skipped)) continue;
    const v = str[f.key];
    if (/[\r\n]/.test(v)) return { error: `${f.label}: invalid characters` };
    if (!v && !f.optional) return { error: `${f.label} is required` };
    if (v && f.kind === "port") {
      const n = Number(v);
      if (!/^\d+$/.test(v) || n < 1 || n > 65535) return { error: `${f.label}: enter a port from 1 to 65535` };
    }
    if (v && f.kind === "select" && !f.options?.some((o) => o.value === v)) return { error: `${f.label}: choose one of the options` };
    if (v && f.pattern && !new RegExp(f.pattern).test(v)) return { error: `${f.label}: ${f.patternMsg ?? "invalid value"}` };
    out.push(v);
    if (f.envKey && v) envPairs.push([f.envKey, v]);
    if (v && (f.flag || f.asArg)) {
      const unchanged = f.argIfChanged && f.envKey && installedEnv?.[f.envKey] === v;
      if (!unchanged) args.push(...(f.asArg ? [v] : [f.flag!, v]));
    }
  }
  return { answers: [...out, ...(sys.stdinAfter ?? [])], envPairs, args };
}

/** True if the VM has a working Docker with the compose plugin (the scripts ask to install it otherwise). */
export async function dockerReady(): Promise<boolean> {
  const r = await runHost(`command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 && docker compose version >/dev/null 2>&1`, 20_000);
  return r.code === 0;
}

async function hostIp(): Promise<string> {
  const r = await runHost(`hostname -I 2>/dev/null | awk '{print $1}'; true`, 8000);
  return r.stdout.trim().split("\n")[0] ?? "";
}

/** Prefill values: existing install's .env first, then the declared default. Passwords are never prefilled. */
export async function formDefaults(sys: SystemDef): Promise<{ values: Record<string, string>; existing: boolean; skipped: Record<string, string> }> {
  const env = await readInstalledEnv(sys);
  const existing = env !== null;
  const ip = (sys.fields ?? []).some((f) => f.default === "@host-ip") ? await hostIp() : "";
  const skipped = await skippedFields(sys);
  const values: Record<string, string> = {};
  for (const f of sys.fields ?? []) {
    values[f.key] = f.kind === "password" ? "" : resolve(f, env ?? {}, ip);
    if (f.prefillFile) {
      const r = await runHost(`cat ${q(f.prefillFile.path)} 2>/dev/null`, 8000);
      const m = r.code === 0 ? new RegExp(f.prefillFile.regex).exec(r.stdout) : null;
      if (m?.[1]) values[f.key] = m[1];
    }
  }
  for (const k of Object.keys(skipped)) values[k] = "";
  return { values, existing, skipped };
}

function resolve(f: Field, env: Record<string, string>, ip: string): string {
  const fromEnv = f.envKey ? env[f.envKey] : "";
  if (fromEnv && f.ignoreValues?.includes(fromEnv)) return f.default ?? "";
  if (fromEnv && f.envMap && f.envMap[fromEnv]) return f.envMap[fromEnv];
  if (fromEnv && !f.envMap && !fromEnv.startsWith("YOUR_")) return fromEnv;
  if (f.default === "@token") return "nats_" + randomBytes(16).toString("hex");
  return f.default === "@host-ip" ? ip : (f.default ?? "");
}

/** Ports in use on the VM (listeners + other containers' published ports). Read-only. */
async function busyPorts(ownContainer?: string | string[]): Promise<Set<number>> {
  const own = ownContainer ? (Array.isArray(ownContainer) ? ownContainer : [ownContainer]) : [];
  const r = await runHost(
    `{ ss -H -ltun 2>/dev/null || netstat -ltun 2>/dev/null | tail -n +3; } | awk '{print $5}' | sed 's/.*[:.]//'
echo ---DOCKER
docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null || true`,
    12_000,
  );
  const busy = new Set<number>();
  const [listen, dock = ""] = r.stdout.split("---DOCKER");
  for (const l of listen.split("\n")) if (/^\d+$/.test(l.trim())) busy.add(Number(l));
  for (const l of dock.split("\n")) {
    if (!l.trim() || own.some((o) => l.startsWith(o))) continue;
    for (const m of l.matchAll(/(?::|\s)(\d+)(?:-(\d+))?->/g)) {
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      for (let p = a; p <= b && p - a < 2000; p++) busy.add(p);
    }
  }
  return busy;
}

export async function checkPorts(sys: SystemDef, wanted: Record<string, number>) {
  const busy = await busyPorts(sys.ownContainer);
  const reserved = new Set(sys.reservedPorts ?? []);
  const taken = new Set<number>();
  const result: Record<string, { port: number; ok: boolean; suggest?: number; reason?: string }> = {};
  for (const [key, port] of Object.entries(wanted)) {
    let reason: string | undefined;
    if (reserved.has(port)) reason = "reserved by this stack or another module";
    else if (busy.has(port)) reason = "in use by another service";
    else if (taken.has(port)) reason = "already chosen for another port";
    if (!reason) {
      taken.add(port);
      result[key] = { port, ok: true };
      continue;
    }
    let c = port + 1;
    while (c <= 65535 && (busy.has(c) || reserved.has(c) || taken.has(c) || Object.values(wanted).includes(c))) c++;
    taken.add(c);
    result[key] = { port, ok: false, suggest: c <= 65535 ? c : undefined, reason };
  }
  return result;
}
