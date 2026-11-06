import { isAuthed, json, unauthorized } from "@/lib/auth";
import { loadSystems } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isAuthed(req)) return unauthorized();
  return json({ systems: loadSystems() });
}
