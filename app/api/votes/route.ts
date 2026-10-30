import { and, eq } from "drizzle-orm";
import { apiError, isTeamMember, persistIdentity, readIdentity } from "../_lib";
import { pollOptions, pollVotes, polls } from "../../../db/schema";

export async function POST(request: Request) {
  const identity = await readIdentity(request);
  if (!identity) return apiError("로그인 후 이용해 주세요.", 401);
  let payload: { pollId?: string; optionId?: string };
  try { payload = await request.json(); } catch { return apiError("투표 정보가 올바르지 않습니다."); }
  if (!payload.pollId || !payload.optionId) return apiError("선택지를 골라 주세요.");
  try {
    const db = await persistIdentity(identity);
    const [poll] = await db.select({ id: polls.id, teamId: polls.teamId, status: polls.status }).from(polls).where(eq(polls.id, payload.pollId)).limit(1);
    if (!poll || !(await isTeamMember(db, poll.teamId, identity.id))) return apiError("투표를 찾을 수 없습니다.", 404);
    if (poll.status !== "open") return apiError("마감된 투표입니다.", 409);
    const [option] = await db.select({ id: pollOptions.id }).from(pollOptions)
      .where(and(eq(pollOptions.id, payload.optionId), eq(pollOptions.pollId, poll.id))).limit(1);
    if (!option) return apiError("선택지가 이 투표에 포함되지 않습니다.");
    await db.insert(pollVotes).values({ pollId: poll.id, optionId: option.id, userId: identity.id })
      .onConflictDoUpdate({ target: [pollVotes.pollId, pollVotes.userId], set: { optionId: option.id } });
    return Response.json({ pollId: poll.id, optionId: option.id });
  } catch (error) {
    console.error("vote save failed", error);
    return apiError("투표를 저장하지 못했습니다.", 500);
  }
}
