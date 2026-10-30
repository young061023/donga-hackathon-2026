import { eq } from "drizzle-orm";
import { apiError, isTeamMember, persistIdentity, readIdentity } from "../_lib";
import { accounts, userPresence } from "../../../db/schema";

export async function POST(request: Request) {
  const identity = await readIdentity(request);
  if (!identity) return apiError("로그인 후 이용해 주세요.", 401);
  let payload: { teamId?: string; mode?: string };
  try { payload = await request.json(); } catch { return apiError("온라인 상태 요청이 올바르지 않습니다."); }
  if (!payload || typeof payload.teamId !== "string" || !["heartbeat", "online", "offline"].includes(payload.mode || "")) return apiError("온라인 상태 요청이 올바르지 않습니다.");
  try {
    const db = await persistIdentity(identity);
    if (!(await isTeamMember(db, payload.teamId, identity.id))) return apiError("이 팀의 온라인 상태를 변경할 수 없습니다.", 403);
    const now = Date.now();
    const enabled = payload.mode === "offline" ? false : payload.mode === "online" ? true : undefined;
    if (enabled !== undefined) await db.update(accounts).set({ onlineEnabled: enabled }).where(eq(accounts.userId, identity.id));
    await db.insert(userPresence).values({ userId: identity.id, lastSeenAt: now })
      .onConflictDoUpdate({ target: userPresence.userId, set: { lastSeenAt: now } });
    const [account] = await db.select({ onlineEnabled: accounts.onlineEnabled }).from(accounts).where(eq(accounts.userId, identity.id)).limit(1);
    return Response.json({ online: Boolean(account?.onlineEnabled), lastSeenAt: now }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("presence update failed", error instanceof Error ? error.message : "unknown");
    return apiError("온라인 상태를 저장하지 못했습니다.", 500);
  }
}
