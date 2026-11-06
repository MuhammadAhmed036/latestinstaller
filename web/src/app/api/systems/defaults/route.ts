import { isAuthed, json, unauthorized } from "@/lib/auth";
import { formDefaults, getSystem } from "@/lib/systems";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isAuthed(req)) return unauthorized();
  const sys = getSystem(new URL(req.url).searchParams.get("system"));
  if (!sys) return json({ error: "Unknown system" }, 404);
  return json(await formDefaults(sys));
}
