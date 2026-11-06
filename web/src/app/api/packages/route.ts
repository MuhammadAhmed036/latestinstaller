import { isAuthed, json, unauthorized } from "@/lib/auth";
import { loadSystems } from "@/lib/config";
import { scanPackages } from "@/lib/packages";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isAuthed(req)) return unauthorized();
  return json({ ...scanPackages(), systems: loadSystems().map((s) => ({ id: s.id, name: s.name })) });
}
