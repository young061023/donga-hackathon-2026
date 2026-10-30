import { eq } from "drizzle-orm";
import { apiError, persistIdentity, readIdentity } from "../_lib";
import { teamMembers, teams } from "../../../db/schema";

export async function POST(request: Request) {
  const identity = await readIdentity(request);
  if (!identity) return apiError("로그인 후 이용해 주세요.", 401);
  let payload: { inviteCode?: string };
  try { payload = await request.json(); } catch { return apiError("초대 정보가 올바르지 않습니다."); }
  const inviteCode = payload.inviteCode?.trim().toLowerCase();
  if (!inviteCode || inviteCode.length > 32) return apiError("초대 링크가 올바르지 않습니다.");
  try {
    const db = await persistIdentity(identity);
    const [team] = await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.inviteCode, inviteCode)).limit(1);
    if (!team) return apiError("초대 링크를 찾을 수 없습니다.", 404);
    await db.insert(teamMembers).values({ teamId: team.id, userId: identity.id, role: "member" }).onConflictDoNothing();
    return Response.json({ team }, { status: 200 });
  } catch (error) {
    console.error("team join failed", error);
    return apiError("팀에 참여하지 못했습니다.", 500);
  }
}
