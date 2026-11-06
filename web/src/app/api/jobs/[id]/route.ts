import { isAuthed, json, unauthorized } from "@/lib/auth";
import { readJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return unauthorized();
  const { id } = await ctx.params;
  const from = Number(new URL(req.url).searchParams.get("from") ?? 0) || 0;
  const r = readJob(id, from);
  return r ? json(r) : json({ error: "Job not found" }, 404);
}
