import fs from "node:fs";
import path from "node:path";
import { isAuthed, json, unauthorized } from "@/lib/auth";
import { PACKAGES_DIR } from "@/lib/config";
import { ARCHIVE_RE } from "@/lib/packages";
import { PART_DIR } from "@/lib/uploads";

export const dynamic = "force-dynamic";

type Row = { name: string; size: number; mtime: number; kind: "bundle" | "checksum" | "other"; partial?: boolean };

function list(dir: string, partial: boolean): Row[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(/*turbopackIgnore: true*/ dir);
  } catch {
    return [];
  }
  const out: Row[] = [];
  for (const n of names) {
    if (n.startsWith(".") && !partial) continue;
    try {
      const st = fs.statSync(/*turbopackIgnore: true*/ path.join(dir, n));
      if (!st.isFile()) continue;
      const name = partial ? n.replace(/\.part$/, "") : n;
      const kind = /\.(sha256|sha256sum|sha512|sha)$/i.test(name) ? "checksum" : ARCHIVE_RE.test(name) ? "bundle" : "other";
      out.push({ name, size: st.size, mtime: st.mtimeMs, kind, ...(partial ? { partial: true } : {}) });
    } catch {
      /* skip */
    }
  }
  return out;
}

export async function GET(req: Request) {
  if (!isAuthed(req)) return unauthorized();
  const files = [...list(PACKAGES_DIR, false), ...list(PART_DIR, true)].sort((a, b) => b.mtime - a.mtime);
  return json({ dir: PACKAGES_DIR, files });
}
