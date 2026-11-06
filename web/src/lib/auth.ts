import crypto from "node:crypto";
import { TOKEN } from "./config";

export const COOKIE = "ivi_session";

export function sessionValue(): string {
  return crypto.createHmac("sha256", TOKEN || "unset").update("ivi-session-v1").digest("hex");
}

export function checkToken(input: string): boolean {
  if (!TOKEN) return false;
  const a = crypto.createHash("sha256").update(input).digest();
  const b = crypto.createHash("sha256").update(TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
}

export function isAuthed(req: Request): boolean {
  if (process.env.INSTALLER_NO_AUTH === "1") return true;
  if (!TOKEN) return false;
  const raw = req.headers.get("cookie") ?? "";
  const m = raw.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!m) return false;
  const val = m.slice(COOKIE.length + 1);
  const exp = sessionValue();
  return val.length === exp.length && crypto.timingSafeEqual(Buffer.from(val), Buffer.from(exp));
}

const fails = new Map<string, { n: number; t: number }>();
export function rateLimited(ip: string): boolean {
  const f = fails.get(ip);
  return !!f && Date.now() - f.t < 60_000 && f.n >= 6;
}
export function recordFail(ip: string) {
  const f = fails.get(ip);
  fails.set(ip, !f || Date.now() - f.t > 60_000 ? { n: 1, t: Date.now() } : { n: f.n + 1, t: f.t });
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}
export const unauthorized = () => json({ error: "unauthorized" }, 401);
