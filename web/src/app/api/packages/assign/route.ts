import { isAuthed, json, unauthorized } from "@/lib/auth";
import { loadSystems } from "@/lib/config";
import { resolvePackage, setAssignment } from "@/lib/packages";

export const dynamic = "force-dynamic";

/** Manually say "this file is the bundle of system X" (or clear it with system: null). */
export async function POST(req: Request) {
  if (!isAuthed(req)) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { file?: string; system?: string | null };
  const pkg = resolvePackage(body.file ?? "");
  if (!pkg) return json({ error: "File not found in the packages folder" }, 404);
  if (body.system && !loadSystems().some((s) => s.id === body.system)) return json({ error: "Unknown system" }, 400);
  setAssignment(pkg.file, body.system ?? null);
  return json({ ok: true });
}
