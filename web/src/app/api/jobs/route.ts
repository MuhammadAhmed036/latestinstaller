import { isAuthed, json, unauthorized } from "@/lib/auth";
import { listJobs } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isAuthed(req)) return unauthorized();
  return json({ jobs: listJobs() });
}
