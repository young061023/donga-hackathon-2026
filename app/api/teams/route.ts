import { apiError, newId, newInviteCode, persistIdentity, readIdentity } from "../_lib";
import { channels, teamMembers, teams } from "../../../db/schema";

export async function POST(request: Request) {
  const identity = readIdentity(request);
  if (!identity) return apiError("ChatGPT 로그인 후 이용해 주세요.", 401);
  let payload: { name?: string };
  try { payload = await request.json(); } catch { return apiError("팀 정보가 올바르지 않습니다."); }
  const name = payload.name?.trim();
  if (!name || name.length > 60) return apiError("팀 이름은 1~60자로 입력해 주세요.");
  try {
    const db = await persistIdentity(identity);
    const teamId = newId("team");
    const inviteCode = newInviteCode();
    await db.insert(teams).values({ id: teamId, name, ownerId: identity.id, inviteCode });
    await db.insert(teamMembers).values({ teamId, userId: identity.id, role: "owner" });
    const channelId = newId("channel");
    await db.insert(channels).values({ id: channelId, teamId, name: "팀 대화" });
    return Response.json({ team: { id: teamId, name, inviteCode }, channel: { id: channelId, name: "팀 대화" } }, { status: 201 });
  } catch (error) {
    console.error("team create failed", error);
    return apiError("팀을 만들지 못했습니다.", 500);
  }
}
