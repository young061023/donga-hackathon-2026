import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { sessions } from "../../../../db/schema";
import { hashToken } from "../../../../lib/password";
import { readSessionToken, safeReturn, sessionCookie } from "../../../../lib/session";
export async function GET(request: Request) {
  const token = readSessionToken(request.headers.get("cookie"));
  if (token) await getDb().delete(sessions).where(eq(sessions.tokenHash, await hashToken(token)));
  return new Response(null, { status: 302, headers: {
    Location: safeReturn(new URL(request.url).searchParams.get("return_to")),
    "Cache-Control": "no-store",
    "Set-Cookie": `${sessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  }});
}
