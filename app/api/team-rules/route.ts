import { eq } from "drizzle-orm";
import { apiError, isTeamMember, persistIdentity, readIdentity } from "../_lib";
import { teams } from "../../../db/schema";

export async function PUT(request: Request) {
  const identity = await readIdentity(request);
  if (!identity) return apiError("로그인 후 이용해 주세요.", 401);
  if (request.headers.get("sec-fetch-site") === "cross-site" || !request.headers.get("content-type")?.startsWith("application/json")) return apiError("허용되지 않은 요청입니다.", 403);

  let payload: { teamId?: string; rules?: string };
  try { payload = await request.json(); } catch { return apiError("팀 약속을 저장할 수 없습니다."); }
  if (!payload || typeof payload !== "object") return apiError("팀 약속을 저장할 수 없습니다.");
  const teamId = payload?.teamId?.trim();
  if (!teamId || teamId.length > 100 || typeof payload.rules !== "string" || payload.rules.length > 2000) return apiError("팀과 약속을 확인해 주세요.");
  const rules = payload.rules.split(/\r?\n/).map(rule => rule.trim()).filter(Boolean);
  if (rules.length < 1 || rules.length > 8 || rules.some(rule => rule.length > 160)) {
    return apiError("팀 약속은 1~8개, 항목마다 160자 이내로 입력해 주세요.");
  }

  try {
    const db = await persistIdentity(identity);
    if (!(await isTeamMember(db, teamId, identity.id))) return apiError("팀원만 팀 약속을 수정할 수 있습니다.", 403);
    const value = rules.join("\n");
    await db.update(teams).set({ rules: value }).where(eq(teams.id, teamId));
    return Response.json({ rules: value }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("team rules update failed", error);
    return apiError("팀 약속을 저장하지 못했습니다.", 500);
  }
}
