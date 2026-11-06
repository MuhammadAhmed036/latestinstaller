import { isAuthed, json, unauthorized } from "@/lib/auth";
import { getSystem } from "@/lib/systems";
import { inspectPackage, resolvePackage } from "@/lib/packages";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isAuthed(req)) return unauthorized();
  const file = new URL(req.url).searchParams.get("file") ?? "";
  const pkg = resolvePackage(file);
  if (!pkg) return json({ error: "Unknown package" }, 404);
  return json(await inspectPackage(pkg, getSystem(pkg.system?.id)?.entry));
}
