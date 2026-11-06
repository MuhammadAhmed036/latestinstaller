import { isAuthed, json, unauthorized } from "@/lib/auth";
import { loadSystems } from "@/lib/config";
import { q, runHost } from "@/lib/host";

export const dynamic = "force-dynamic";

function find(id: string | null) {
  return loadSystems().find((s) => s.id === id && s.envFile);
}

export async function GET(req: Request) {
  if (!isAuthed(req)) return unauthorized();
  const sys = find(new URL(req.url).searchParams.get("system"));
  if (!sys) return json({ error: "Unknown system" }, 400);
  const r = await runHost(`[ -f ${q(sys.envFile!)} ] && cat ${q(sys.envFile!)}`, 10_000);
  if (r.code !== 0) return json({ error: `${sys.envFile} not found. Is the system installed?` }, 404);
  return json({ path: sys.envFile, content: r.stdout });
}

export async function PUT(req: Request) {
  if (!isAuthed(req)) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { system?: string; content?: string };
  const sys = find(body.system ?? null);
  if (!sys || typeof body.content !== "string") return json({ error: "Bad request" }, 400);
  if (body.content.length > 200_000) return json({ error: "File too large" }, 413);
  const b64 = Buffer.from(body.content, "utf8").toString("base64");
  const f = q(sys.envFile!);
  const script = `set -e
cp -p ${f} ${f}.bak
echo ${q(b64)} | base64 -d > ${f}.tmp
chmod --reference=${f}.bak ${f}.tmp
mv ${f}.tmp ${f}`;
  const r = await runHost(script, 15_000);
  if (r.code !== 0) return json({ error: r.stderr || "Write failed" }, 500);
  return json({ ok: true, backup: `${sys.envFile}.bak` });
}
