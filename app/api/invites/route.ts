import { eq } from "drizzle-orm";
import { apiError, isTeamMember, persistIdentity, readIdentity } from "../_lib";
import { teams } from "../../../db/schema";

export async function POST(request: Request) {
  const identity = readIdentity(request);
  if (!identity) return apiError("ChatGPT 로그인 후 이용해 주세요.", 401);
  let payload: { teamId?: string };
  try { payload = await request.json(); } catch { return apiError("초대 정보가 올바르지 않습니다."); }
  const teamId = payload.teamId?.trim();
  if (!teamId) return apiError("팀을 선택해 주세요.");
  try {
    const db = await persistIdentity(identity);
    if (!(await isTeamMember(db, teamId, identity.id))) return apiError("이 팀에 초대할 권한이 없습니다.", 403);
    const [team] = await db.select({ inviteCode: teams.inviteCode }).from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!team) return apiError("팀을 찾을 수 없습니다.", 404);
    const url = new URL("/app/?join=" + encodeURIComponent(team.inviteCode), request.url).toString();
    return Response.json({ url });
  } catch (error) {
    console.error("invite create failed", error);
    return apiError("초대 링크를 만들지 못했습니다.", 500);
  }
}
