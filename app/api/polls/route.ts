import { apiError, isTeamMember, newId, persistIdentity, readIdentity } from "../_lib";
import { pollOptions, polls } from "../../../db/schema";

export async function POST(request: Request) {
  const identity = readIdentity(request);
  if (!identity) return apiError("ChatGPT 로그인 후 이용해 주세요.", 401);
  let payload: { teamId?: string; title?: string; options?: string[]; closesAt?: string | null };
  try { payload = await request.json(); } catch { return apiError("투표 정보가 올바르지 않습니다."); }
  const teamId = payload.teamId?.trim();
  const title = payload.title?.trim();
  const options = Array.isArray(payload.options) ? payload.options.map((option) => option.trim()).filter(Boolean) : [];
  if (!teamId || !title || title.length > 160 || options.length < 2 || options.length > 8 || options.some((option) => option.length > 100)) {
    return apiError("질문과 2~8개의 선택지를 입력해 주세요.");
  }
  try {
    const db = await persistIdentity(identity);
    if (!(await isTeamMember(db, teamId, identity.id))) return apiError("이 팀에서 투표를 만들 수 없습니다.", 403);
    const pollId = newId("poll");
    await db.insert(polls).values({ id: pollId, teamId, title, createdBy: identity.id, closesAt: payload.closesAt?.slice(0, 40) || null });
    await db.insert(pollOptions).values(options.map((label, position) => ({ id: newId("opt"), pollId, label, position })));
    return Response.json({ id: pollId }, { status: 201 });
  } catch (error) {
    console.error("poll create failed", error);
    return apiError("투표를 만들지 못했습니다.", 500);
  }
}
