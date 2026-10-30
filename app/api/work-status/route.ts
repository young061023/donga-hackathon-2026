import { and, eq } from "drizzle-orm";
import { apiError, isTeamMember, persistIdentity, readIdentity } from "../_lib";
import { workStatuses } from "../../../db/schema";

const allowed = new Set(["available", "needs_adjustment", "away"]);

export async function PUT(request: Request) {
  const identity = await readIdentity(request);
  if (!identity) return apiError("로그인 후 이용해 주세요.", 401);
  let payload: { teamId?: string; status?: string };
  try { payload = await request.json(); } catch { return apiError("업무 상태가 올바르지 않습니다."); }
  if (!payload.teamId || !payload.status || !allowed.has(payload.status)) return apiError("업무 상태를 선택해 주세요.");
  try {
    const db = await persistIdentity(identity);
    if (!(await isTeamMember(db, payload.teamId, identity.id))) return apiError("이 팀의 상태를 변경할 수 없습니다.", 403);
    await db.insert(workStatuses).values({ teamId: payload.teamId, userId: identity.id, status: payload.status, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({ target: [workStatuses.teamId, workStatuses.userId], set: { status: payload.status, updatedAt: new Date().toISOString() } });
    return Response.json({ status: payload.status });
  } catch (error) {
    console.error("work status update failed", error);
    return apiError("업무 상태를 저장하지 못했습니다.", 500);
  }
}
