import { COOKIE, checkToken, json, rateLimited, recordFail, sessionValue } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") ?? "local";
  if (rateLimited(ip)) return json({ error: "Too many attempts. Wait a minute." }, 429);
  const body = (await req.json().catch(() => ({}))) as { token?: string };
  if (!body.token || !checkToken(body.token.trim())) {
    recordFail(ip);
    return json({ error: "Invalid access token." }, 401);
  }
  return json({ ok: true }, 200, {
    "set-cookie": `${COOKIE}=${sessionValue()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`,
  });
}
