import { and, eq, gt } from "drizzle-orm";
import { getDb } from "../db";
import { sessions, users } from "../db/schema";
import { hashToken } from "./password";
export const sessionCookie = "moa_session";
export function readSessionToken(cookie: string | null) {
  return cookie?.split(";").map(value => value.trim()).find(value => value.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1);
}
export async function sessionIdentity(cookie: string | null) {
  const token = readSessionToken(cookie);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const [user] = await getDb().select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, await hashToken(token)), gt(sessions.expiresAt, Date.now()))).limit(1);
  return user ?? null;
}
export function safeReturn(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/app/";
  try {
    const url = new URL(value, "https://moa.invalid");
    return url.origin === "https://moa.invalid" && !url.pathname.startsWith("/api/auth") ? url.pathname + url.search + url.hash : "/app/";
  } catch { return "/app/"; }
}
