import { isAuthed, json, unauthorized } from "@/lib/auth";
import { VERSION, WORK_DIR } from "@/lib/config";
import { q, runHost } from "@/lib/host";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isAuthed(req)) return unauthorized();
  const r = await runHost(
    `mkdir -p ${q(WORK_DIR)} 2>/dev/null
echo "hostname=$(hostname)"
echo "os=$( . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" )"
echo "ip=$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "docker=$(docker --version 2>/dev/null | sed 's/Docker version //;s/,.*//')"
echo "free=$(df -PB1 ${q(WORK_DIR)} 2>/dev/null | awk 'NR==2{print $4}')"
echo "root=$([ "$(id -u)" -eq 0 ] && echo 1 || echo 0)"`,
    15_000,
  );
  const info: Record<string, string> = {};
  for (const l of r.stdout.split("\n")) {
    const i = l.indexOf("=");
    if (i > 0) info[l.slice(0, i)] = l.slice(i + 1).trim();
  }
  return json({ version: VERSION, ...info });
}
