import { env } from "cloudflare:workers";
import { and, desc, eq, sql } from "drizzle-orm";
import { apiError, isTeamMember, newId, persistIdentity, readIdentity } from "../_lib";
import { channels, messages, tasks, teamMembers, teams, users } from "../../../db/schema";
import { allocateTeamRoles } from "../../../lib/role-allocation-ai";

export async function POST(request: Request) {
  const identity = await readIdentity(request);
  if (!identity) return apiError("로그인 후 이용해 주세요.", 401);
  if (request.headers.get("sec-fetch-site") === "cross-site" || !request.headers.get("content-type")?.startsWith("application/json")) return apiError("허용되지 않은 요청입니다.", 403);

  let payload: { teamId?: string; channelId?: string; messageId?: string };
  try { payload = await request.json(); } catch { return apiError("요청 형식이 올바르지 않습니다."); }
  if (typeof payload?.teamId !== "string" || typeof payload.channelId !== "string" || typeof payload.messageId !== "string") return apiError("팀 대화와 메시지를 확인해 주세요.");
  const teamId = payload.teamId.trim();
  const channelId = payload.channelId.trim();
  const messageId = payload.messageId.trim();
  if (!teamId || !channelId || !messageId || [teamId, channelId, messageId].some(value => value.length > 120)) return apiError("팀 대화와 메시지를 확인해 주세요.");

  try {
    const db = await persistIdentity(identity);
    if (!(await isTeamMember(db, teamId, identity.id))) return apiError("팀원만 역할 분담을 요청할 수 있습니다.", 403);
    const [channel] = await db.select({ id: channels.id, name: channels.name }).from(channels)
      .where(and(eq(channels.id, channelId), eq(channels.teamId, teamId))).limit(1);
    if (!channel) return apiError("채널을 찾을 수 없습니다.", 404);
    if (!env.GEMINI_API_KEY) return apiError("서버의 Gemini API 설정을 확인해 주세요.", 503);

    const [source] = await db.select({ id: messages.id, authorId: messages.authorId, body: messages.body })
      .from(messages).where(and(eq(messages.id, messageId), eq(messages.teamId, teamId), eq(messages.channelId, channelId), eq(messages.authorType, "user"))).limit(1);
    if (!source || source.authorId !== identity.id) return apiError("역할 분담을 요청한 메시지를 찾을 수 없습니다.", 404);

    const [existing] = await db.select({ id: messages.id }).from(messages).where(and(
      eq(messages.teamId, teamId), eq(messages.channelId, channelId), eq(messages.authorType, "assistant"), eq(messages.sourceMessageId, messageId),
    )).limit(1);
    if (existing) return Response.json({ skipped: true }, { headers: { "Cache-Control": "no-store" } });

    const [memberRows, recent, existingTasks, team] = await Promise.all([
      db.select({ id: users.id, name: users.displayName }).from(teamMembers).innerJoin(users, eq(users.id, teamMembers.userId))
        .where(eq(teamMembers.teamId, teamId)),
      db.select({ id: messages.id, authorType: messages.authorType, body: messages.body, author: users.displayName })
        .from(messages).leftJoin(users, eq(users.id, messages.authorId))
        .where(and(eq(messages.teamId, teamId), eq(messages.channelId, channelId), eq(messages.authorType, "user")))
        .orderBy(desc(messages.createdAt), desc(sql`${messages}.rowid`)).limit(12),
      db.select({ title: tasks.title, assigneeId: tasks.assigneeId, dueText: tasks.dueText, status: tasks.status })
        .from(tasks).where(eq(tasks.teamId, teamId)).limit(40),
      db.select({ rules: teams.rules }).from(teams).where(eq(teams.id, teamId)).limit(1).then(rows => rows[0]),
    ]);
    const transcript = recent.reverse().map(message => ({ author: message.author || "팀원", text: message.body.slice(0, 600) }));
    const allocation = await allocateTeamRoles({
      channel: channel.name,
      teamRules: team?.rules || "",
      members: memberRows,
      recentMessages: transcript,
      currentRequest: source.body,
      existingTasks,
    }, env.GEMINI_API_KEY, env.GEMINI_MODEL || "gemini-3.8-flash");

    const allowedMembers = new Map(memberRows.map(member => [member.id, member.name]));
    if (allocation.tasks.some(task => !allowedMembers.has(task.assigneeId))) throw new Error("AI_INVALID_ASSIGNEE");
    const [latest] = await db.select({ id: messages.id }).from(messages).where(and(
      eq(messages.teamId, teamId), eq(messages.channelId, channelId), eq(messages.authorType, "user"),
    )).orderBy(desc(messages.createdAt), desc(sql`${messages}.rowid`)).limit(1);
    if (latest?.id !== messageId) return Response.json({ skipped: true }, { headers: { "Cache-Control": "no-store" } });

    for (const task of allocation.tasks) {
      await db.insert(tasks).values({
        id: newId("task"), teamId, title: task.title, assigneeId: task.assigneeId,
        createdBy: identity.id, dueText: task.dueText, sourceMessageId: null,
      });
    }
    const details = allocation.tasks.map(task => `• ${task.title} — ${allowedMembers.get(task.assigneeId)}${task.dueText ? ` (${task.dueText})` : ""}`);
    const reply = details.length ? `${allocation.reply}\n\n${details.join("\n")}` : allocation.reply;
    const assistantId = newId("msg");
    await db.insert(messages).values({ id: assistantId, teamId, channelId, authorId: null, authorType: "assistant", sourceMessageId: messageId, body: reply });
    return Response.json({ messageId: assistantId, taskCount: allocation.tasks.length }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("role allocation AI error", reason);
    if (/^AI_PROVIDER_ERROR:429:/.test(reason)) return apiError("Gemini 사용 한도에 도달해 역할을 나누지 못했어요. 잠시 후 다시 시도해 주세요.", 429);
    if (/^AI_PROVIDER_ERROR:503:/.test(reason)) return apiError("Gemini가 혼잡해 역할을 나누지 못했어요. 대화는 저장됐으니 잠시 후 다시 시도해 주세요.", 502);
    if (error instanceof Error && error.name === "TimeoutError") return apiError("AI 응답이 늦어 역할을 나누지 못했어요. 잠시 후 다시 시도해 주세요.", 504);
    return apiError("AI 역할 분담을 만들지 못했어요. 잠시 후 다시 시도해 주세요.", 502);
  }
}
