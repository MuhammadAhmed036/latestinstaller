import fs from "node:fs";
import { isAuthed, json, unauthorized } from "@/lib/auth";
import { PACKAGES_DIR } from "@/lib/config";
import { CHUNK_MAX, MAX_TOTAL, PART_DIR, finalPath, freeBytes, nameError, partPath, sizeOf } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/** State of a file on the VM: does it exist, and how much of an interrupted upload is already there. */
export async function GET(req: Request) {
  if (!isAuthed(req)) return unauthorized();
  const name = new URL(req.url).searchParams.get("name");
  const bad = nameError(name);
  if (bad) return json({ error: bad }, 400);
  const exists = sizeOf(finalPath(name!));
  const partial = sizeOf(partPath(name!));
  return json({ exists: exists >= 0 ? exists : null, partial: partial > 0 ? partial : 0 });
}

/** Append one chunk. The client sends offset=0 first; a wrong offset answers 409 with the size the VM really has. */
export async function POST(req: Request) {
  if (!isAuthed(req)) return unauthorized();
  const u = new URL(req.url).searchParams;
  const name = u.get("name");
  const bad = nameError(name);
  if (bad) return json({ error: bad }, 400);
  const offset = Number(u.get("offset"));
  const total = Number(u.get("total"));
  const overwrite = u.get("overwrite") === "1";
  if (!Number.isInteger(offset) || !Number.isInteger(total) || offset < 0 || total <= 0 || total > MAX_TOTAL) return json({ error: "Bad offset or total" }, 400);

  const part = partPath(name!);
  const final = finalPath(name!);
  fs.mkdirSync(PART_DIR, { recursive: true });

  let have = Math.max(sizeOf(part), 0);
  if (offset === 0) {
    if (sizeOf(final) >= 0 && !overwrite) return json({ error: "exists" }, 409);
    if (have > 0) {
      fs.rmSync(part, { force: true });
      have = 0;
    }
    if (freeBytes() < total * 1.02 + 64 * 1024 * 1024) return json({ error: `Not enough free disk space in ${PACKAGES_DIR} for this file` }, 507);
  }
  if (offset !== have) return json({ error: "offset", received: have }, 409);

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0 || buf.length > CHUNK_MAX) return json({ error: "Bad chunk size" }, 400);
  if (offset + buf.length > total) return json({ error: "Chunk goes past the declared size" }, 400);

  const fd = fs.openSync(part, "a");
  try {
    fs.writeSync(fd, buf);
  } finally {
    fs.closeSync(fd);
  }

  const received = offset + buf.length;
  if (received === total) {
    fs.renameSync(part, final);
    return json({ received, done: true });
  }
  return json({ received, done: false });
}

/** ?name=X removes an uploaded file; ?name=X&part=1 cancels a half-finished upload. */
export async function DELETE(req: Request) {
  if (!isAuthed(req)) return unauthorized();
  const u = new URL(req.url).searchParams;
  const name = u.get("name");
  const bad = nameError(name);
  if (bad) return json({ error: bad }, 400);
  fs.rmSync(u.get("part") === "1" ? partPath(name!) : finalPath(name!), { force: true });
  return json({ ok: true });
}
