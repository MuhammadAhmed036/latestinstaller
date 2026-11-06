import { isAuthed, json, unauthorized } from "@/lib/auth";
import { isVisible } from "@/lib/fields";
import { checkPorts, getSystem, skippedFields } from "@/lib/systems";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isAuthed(req)) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { system?: string; ports?: Record<string, string> };
  const sys = getSystem(body.system);
  if (!sys) return json({ error: "Unknown system" }, 404);
  const wanted: Record<string, number> = {};
  const skipped = Object.keys(await skippedFields(sys));
  for (const f of sys.fields ?? []) {
    if (f.kind !== "port" || !isVisible(f, body.ports ?? {}, skipped)) continue;
    const n = Number(body.ports?.[f.key]);
    if (Number.isInteger(n) && n >= 1 && n <= 65535) wanted[f.key] = n;
  }
  return json({ result: await checkPorts(sys, wanted) });
}
