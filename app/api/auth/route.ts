import { eq, sql, lt } from "drizzle-orm";
import { getDb } from "../../../db";
import { accounts, authAttempts, sessions, users } from "../../../db/schema";
import { hashPassword, hashToken, verifyPassword } from "../../../lib/password";
import { safeReturn, sessionCookie } from "../../../lib/session";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || !["https://hmh-young1023.apps.dauai.org", new URL(request.url).origin].includes(origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  }
  try {
    if (Number(request.headers.get("content-length")) > 8192) return Response.json({ error: "입력 내용이 너무 깁니다." }, { status: 413 });
    const raw = await request.text();
    if (raw.length > 8192) return Response.json({ error: "입력 내용이 너무 깁니다." }, { status: 413 });
    const body = JSON.parse(raw) as Record<string, unknown>;
    if (!body || typeof body !== "object") return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
    const { action, password } = body;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (typeof action !== "string" || !["login", "register"].includes(action) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || typeof password !== "string" || password.length < 10 || password.length > 128 || (action === "register" && (!name || name.length > 60))) {
      return Response.json({ error: "이메일, 이름, 비밀번호(10~128자)를 확인해 주세요." }, { status: 400 });
    }
    const db = getDb();
    const now = Date.now();
    const key = await hashToken(email);
    const [attempt] = await db.insert(authAttempts).values({ key, count: 1, expiresAt: now + 900_000 })
      .onConflictDoUpdate({ target: authAttempts.key, set: {
        count: sql`CASE WHEN ${authAttempts.expiresAt} < ${now} THEN 1 ELSE ${authAttempts.count} + 1 END`,
        expiresAt: sql`CASE WHEN ${authAttempts.expiresAt} < ${now} THEN ${now + 900_000} ELSE ${authAttempts.expiresAt} END`,
      }}).returning();
    if (attempt.count > 20) return Response.json({ error: "시도가 너무 많습니다. 15분 후 다시 시도해 주세요." }, { status: 429 });
    const [account] = await db.select().from(accounts).where(eq(accounts.email, email)).limit(1);
    let userId: string;
    if (action === "register") {
      if (account) return Response.json({ error: "이미 가입한 이메일입니다. 로그인해 주세요." }, { status: 409 });
      userId = `user_${crypto.randomUUID()}`;
      const passwordHash = await hashPassword(password);
      await db.batch([
        db.insert(users).values({ id: userId, email, displayName: name }),
        db.insert(accounts).values({ userId, email, passwordHash }),
      ]);
    } else {
      // Derive even for an unknown account to avoid a fast account lookup oracle.
      const valid = await verifyPassword(password, account?.passwordHash ?? `pbkdf2$${"0".repeat(32)}$${"0".repeat(64)}`);
      if (!account || !valid) return Response.json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
      userId = account.userId;
    }
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
    await db.insert(sessions).values({ tokenHash: await hashToken(token), userId, expiresAt: now + 604_800_000 });
    await db.delete(sessions).where(lt(sessions.expiresAt, now));
    return Response.json({ returnTo: safeReturn(body.returnTo) }, { headers: {
      "Cache-Control": "no-store",
      "Set-Cookie": `${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${origin.startsWith("https:") ? "; Secure" : ""}`,
    }});
  } catch (error) {
    console.error("Member authentication failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "로그인을 처리하지 못했습니다. 서버 DB 초기화 상태를 확인해 주세요." }, { status: 500 });
  }
}
