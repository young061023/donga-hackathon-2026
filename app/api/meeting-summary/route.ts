import { env } from "cloudflare:workers";
import { and, desc, eq } from "drizzle-orm";
import { apiError, isTeamMember, persistIdentity, readIdentity } from "../_lib";
import { channels, messages, polls, tasks, users } from "../../../db/schema";
import { summarizeMeeting } from "../../../lib/meeting-summary-ai";

export async function POST(request: Request) {
  const identity = await readIdentity(request);
  if (!identity) return apiError("로그인 후 이용해 주세요.", 401);
  if (request.headers.get("sec-fetch-site") === "cross-site" || !request.headers.get("content-type")?.startsWith("application/json")) return apiError("허용되지 않은 요청입니다.", 403);

  let payload: { teamId?: string; channelId?: string };
  try { payload = await request.json(); } catch { return apiError("요청 형식이 올바르지 않습니다."); }
  if (!payload || typeof payload !== "object" || typeof payload.teamId !== "string" || typeof payload.channelId !== "string") return apiError("팀과 채널을 선택해 주세요.");
  const teamId = payload.teamId.trim();
  const channelId = payload.channelId.trim();
  if (!teamId || !channelId || teamId.length > 100 || channelId.length > 100) return apiError("팀과 채널을 선택해 주세요.");

  try {
    const db = await persistIdentity(identity);
    if (!(await isTeamMember(db, teamId, identity.id))) return apiError("팀원만 회의를 정리할 수 있습니다.", 403);
    const [channel] = await db.select({ id: channels.id, name: channels.name }).from(channels)
      .where(and(eq(channels.id, channelId), eq(channels.teamId, teamId))).limit(1);
    if (!channel) return apiError("채널을 찾을 수 없습니다.", 404);
    if (!env.GEMINI_API_KEY) return apiError("Gemini API 키가 서버에 설정되지 않았습니다.", 503);

    const rows = await db.select({ id: messages.id, body: messages.body, author: users.displayName, createdAt: messages.createdAt })
      .from(messages).leftJoin(users, eq(users.id, messages.authorId))
      .where(and(eq(messages.teamId, teamId), eq(messages.channelId, channel.id), eq(messages.authorType, "user")))
      .orderBy(desc(messages.createdAt)).limit(50);
    if (!rows.length) return apiError("회의를 정리할 대화가 아직 없습니다.");
    const recentMessages = rows.reverse().map(row => ({ ...row, body: row.body.slice(0, 1600) }));
    const openTasks = await db.select({ title: tasks.title, status: tasks.status, dueText: tasks.dueText, owner: users.displayName })
      .from(tasks).leftJoin(users, eq(users.id, tasks.assigneeId)).where(eq(tasks.teamId, teamId)).limit(30);
    const activePolls = await db.select({ title: polls.title, status: polls.status })
      .from(polls).where(eq(polls.teamId, teamId)).orderBy(desc(polls.createdAt)).limit(10);
    const allowedIds = new Set(recentMessages.map(message => message.id));
    const summary = await summarizeMeeting({
      topic: channel.name,
      messages: recentMessages,
      currentTasks: openTasks,
      polls: activePolls,
    }, env.GEMINI_API_KEY, env.GEMINI_MODEL || "gemini-3.8-flash", allowedIds);
    return Response.json({ summary }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    console.error("meeting summary AI error", reason || (error instanceof Error ? error.name : "unknown"));
    if (/^AI_PROVIDER_ERROR:401:|^AI_PROVIDER_ERROR:403:/.test(reason)) return apiError("Gemini API 키 또는 프로젝트 권한을 확인해 주세요.", 502);
    if (/^AI_PROVIDER_ERROR:429:/.test(reason)) return apiError("Gemini 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.", 429);
    if (/^AI_PROVIDER_ERROR:503:/.test(reason)) return apiError("Gemini 모델이 혼잡해 회의 정리를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.", 502);
    if (reason === "AI_BLOCKED") return apiError("대화 일부를 AI가 분석하지 못했습니다. 표현을 바꿔 다시 시도해 주세요.", 422);
    return apiError("AI 회의 정리를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.", 502);
  }
}
