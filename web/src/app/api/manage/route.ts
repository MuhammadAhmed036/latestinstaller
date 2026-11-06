import { isAuthed, json, unauthorized } from "@/lib/auth";
import { loadSystems } from "@/lib/config";
import { hasRunningJob, startJob } from "@/lib/jobs";
import { CTL_STEPS, buildCtlScript } from "@/lib/scripts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isAuthed(req)) return unauthorized();
  return json({ systems: loadSystems().filter((s) => s.ctl || s.ctlCommands?.length) });
}

export async function POST(req: Request) {
  if (!isAuthed(req)) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { system?: string; cmd?: string };
  const sys = loadSystems().find((s) => s.id === body.system && (s.ctl || s.ctlCommands?.length));
  const def = sys?.ctlCommands?.find((c) => c.cmd === body.cmd);
  if (!sys || !def) return json({ error: "Unknown system or command" }, 400);
  if (hasRunningJob()) return json({ error: "Another job is still running." }, 409);
  const job = startJob({
    kind: "manage",
    title: `${sys.name}: ${def.label}`,
    subtitle: def.run ?? `${sys.ctl!.split("/").pop()} ${def.cmd}`,
    steps: CTL_STEPS,
    script: buildCtlScript(sys, def.cmd, def.timeout, def.run),
  });
  return json({ job });
}
