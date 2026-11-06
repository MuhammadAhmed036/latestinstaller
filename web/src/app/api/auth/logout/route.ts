import { COOKIE, json } from "@/lib/auth";

export const dynamic = "force-dynamic";

export function POST() {
  return json({ ok: true }, 200, { "set-cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` });
}
