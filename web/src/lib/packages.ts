import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, PACKAGES_DIR, loadSystems, type SystemDef } from "./config";
import { q, runHost } from "./host";

export type Pkg = {
  file: string;
  size: number;
  mtime: number;
  /** Checksum file found next to the bundle. Optional: deploys never depend on it. */
  sidecar: string | null;
  expectedSha: string | null;
  parsed: { name: string; version: string; commit: string; mode: string; date: string | null; flag: string | null } | null;
  system: { id: string; name: string } | null;
  /** The bundle's contents are still being read to work out which system it is. */
  detecting: boolean;
  /** The operator assigned this file to its system by hand. */
  manual: boolean;
};

export const ARCHIVE_RE = /\.(tar\.gz|tgz|tar\.xz|txz|tar\.bz2|tbz2|tar)$/i;
export const stemOf = (file: string) => file.replace(ARCHIVE_RE, "");

const NAME_RE = /^(.+?)_(\d+\.\d+\.\d+[\w.-]*?)_([0-9a-f]{6,40})_(offline|online)(?:_(\d{8}))?(?:[-_]([A-Za-z0-9]+))?\.(?:tar\.gz|tgz|tar)$/i;
const HASH_RE = /\b([0-9a-fA-F]{64})\b/;
const SMALL = 4096;

/* ── archive listing (cached) ───────────────────────────────────────────────────────────── */

type Listing = { entries: string[]; error?: string };
const g = globalThis as unknown as { __lists?: Map<string, Promise<Listing>>; __listsDone?: Map<string, Listing> };
const pending = (g.__lists ??= new Map());
const done = (g.__listsDone ??= new Map());
const keyOf = (p: { file: string; size: number; mtime: number }) => `${p.file}|${p.size}|${Math.round(p.mtime)}`;

/** Full file list of the archive (names only). Cached per file+size+mtime, so a renamed or replaced bundle is re-read. */
export function listArchive(p: { file: string; size: number; mtime: number }): Promise<Listing> {
  const key = keyOf(p);
  const hit = pending.get(key);
  if (hit) return hit;
  const full = path.posix.join(PACKAGES_DIR.replace(/\\/g, "/"), p.file);
  const job = runHost(`tar -tf ${q(full)} 2>/dev/null | sed 's#^\\./##' | head -n 50000`, 900_000).then((r) => {
    const entries = r.stdout.split("\n").filter(Boolean);
    const res: Listing = entries.length ? { entries } : { entries, error: "Archive could not be listed (corrupt or unreadable)." };
    done.set(key, res);
    return res;
  });
  pending.set(key, job);
  return job;
}

/** The system whose signature files (all of `detect`) are present in the archive. Most specific wins. */
function detectFrom(entries: string[], systems: SystemDef[]): SystemDef | null {
  let best: SystemDef | null = null;
  for (const s of systems) {
    if (!s.detect?.length) continue;
    const ok = s.detect.every((p) => entries.some((e) => e === p || e.endsWith(`/${p}`)));
    if (ok && (!best || s.detect.length > (best.detect?.length ?? 0))) best = s;
  }
  return best;
}

/* ── checksum files ────────────────────────────────────────────────────────────────────── */

type HashFile = { name: string; text: string };

function readSmallHashFiles(names: string[]): HashFile[] {
  const out: HashFile[] = [];
  for (const name of names) {
    try {
      const full = path.join(PACKAGES_DIR, name);
      const st = fs.statSync(/*turbopackIgnore: true*/ full);
      if (!st.isFile() || st.size > SMALL || st.size < 64) continue;
      const text = fs.readFileSync(/*turbopackIgnore: true*/ full, "utf8");
      if (text.includes("\u0000")) continue; // binary
      if (HASH_RE.test(text)) out.push({ name, text });
    } catch {
      /* skip */
    }
  }
  return out;
}

/** Best-effort pairing: by name, by the file name written inside, or the only candidate. Never required. */
function pickChecksum(file: string, hashFiles: HashFile[], archiveCount: number): { sidecar: string; sha: string | null } | null {
  const stem = stemOf(file).toLowerCase();
  const lower = file.toLowerCase();
  const ranked = hashFiles
    .map((h) => {
      const n = h.name.toLowerCase();
      let score = 0;
      if (n === `${lower}.sha256` || n === `${lower}.sha256sum` || n === `${stem}.sha256`) score = 4;
      else if (n.startsWith(stem)) score = 3;
      else if (h.text.includes(file)) score = 3;
      else if (hashFiles.length === 1 && archiveCount === 1) score = 1;
      return { h, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = ranked[0]?.h;
  if (!best) return null;
  const lines = best.text.split("\n");
  const own = lines.find((l) => l.includes(file) && HASH_RE.test(l)) ?? lines.find((l) => HASH_RE.test(l));
  return { sidecar: best.name, sha: own ? (HASH_RE.exec(own)?.[1]?.toLowerCase() ?? null) : null };
}

/* ── manual assignments ─────────────────────────────────────────────────────────────────── */

const ASSIGN_FILE = path.join(DATA_DIR, "assignments.json");

export function loadAssignments(): Record<string, string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ ASSIGN_FILE, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Pin a file to a system (or clear the pin with null). Survives renames of nothing: it is keyed by file name. */
export function setAssignment(file: string, systemId: string | null) {
  const all = loadAssignments();
  if (systemId) all[file] = systemId;
  else delete all[file];
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ASSIGN_FILE, JSON.stringify(all, null, 2));
}

/* ── scan ──────────────────────────────────────────────────────────────────────────────── */

export function matchSystem(file: string, systems: SystemDef[] = loadSystems()): SystemDef | null {
  return systems.find((s) => s.match && new RegExp(s.match, "i").test(file)) ?? null;
}

export function scanPackages(): { dir: string; exists: boolean; packages: Pkg[] } {
  const systems = loadSystems();
  let names: string[] = [];
  try {
    names = fs.readdirSync(PACKAGES_DIR);
  } catch {
    return { dir: PACKAGES_DIR, exists: false, packages: [] };
  }

  // A tiny file holding a SHA-256 is a checksum file, whatever it is called (even ending in .tar.gz).
  const assignments = loadAssignments();
  const hashFiles = readSmallHashFiles(names);
  const hashNames = new Set(hashFiles.map((h) => h.name));
  const archives = names.filter((n) => ARCHIVE_RE.test(n) && !hashNames.has(n));

  const packages: Pkg[] = [];
  for (const file of archives) {
    let st: fs.Stats;
    try {
      st = fs.statSync(/*turbopackIgnore: true*/ path.join(PACKAGES_DIR, file));
    } catch {
      continue;
    }
    if (!st.isFile()) continue;

    const cs = pickChecksum(file, hashFiles, archives.length);
    const m = NAME_RE.exec(file);
    const parsed = m ? { name: m[1], version: m[2], commit: m[3], mode: m[4].toLowerCase(), date: m[5] ?? null, flag: m[6] ?? null } : null;

    // 0) chosen by hand, 1) by file name, 2) by what is inside the archive (survives a renamed bundle)
    const pinned = assignments[file] ? (systems.find((s) => s.id === assignments[file]) ?? null) : null;
    let sys = pinned ?? matchSystem(file, systems);
    let detecting = false;
    if (!sys && systems.some((s) => s.detect?.length)) {
      const id = { file, size: st.size, mtime: st.mtimeMs };
      const listing = done.get(keyOf(id));
      if (listing) sys = detectFrom(listing.entries, systems);
      else {
        detecting = true;
        listArchive(id).catch(() => {});
      }
    }

    packages.push({
      file,
      size: st.size,
      mtime: st.mtimeMs,
      sidecar: cs?.sidecar ?? null,
      expectedSha: cs?.sha ?? null,
      parsed,
      system: sys ? { id: sys.id, name: sys.name } : null,
      detecting,
      manual: !!pinned,
    });
  }
  packages.sort((a, b) => b.mtime - a.mtime);
  return { dir: PACKAGES_DIR, exists: true, packages };
}

export function resolvePackage(file: string): Pkg | null {
  if (!file || file !== path.basename(file)) return null;
  return scanPackages().packages.find((p) => p.file === file) ?? null;
}

export type Inspect = { entries: string[]; top: string | null; entryScript: string | null; error?: string };

/** Find the entry script (nearest match within 3 levels; the bundle may sit in a wrapper folder). */
export async function inspectPackage(pkg: Pkg, systemEntry?: string[]): Promise<Inspect> {
  const { entries, error } = await listArchive(pkg);
  if (error) return { entries, top: null, entryScript: null, error };
  const candidates = systemEntry?.length ? systemEntry : ["install.sh", "deploy.sh"];
  const tops = new Set(entries.map((e) => e.split("/")[0]));
  const single = tops.size === 1 && entries.some((e) => e.includes("/")) ? [...tops][0] : null;
  let entryScript: string | null = null;
  for (const c of candidates) {
    const hit = entries.find((e) => e === c || (e.endsWith(`/${c}`) && e.split("/").length <= 3));
    if (hit) {
      entryScript = c;
      break;
    }
  }
  return { entries: entries.slice(0, 40), top: single, entryScript };
}
