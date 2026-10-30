import { env } from "cloudflare:workers";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { apiError, isTeamMember, persistIdentity, readIdentity } from "../_lib";
import { authAttempts, channels, messages, users } from "../../../db/schema";
import { summarizeBrainstorm } from "../../../lib/brainstorm-ai";

export async function POST(request: Request) {
  const identity = await readIdentity(request);
  if (!identity) return apiError("로그인 후 이용해 주세요.", 401);
  if (request.headers.get("sec-fetch-site") === "cross-site" || !request.headers.get("content-type")?.startsWith("application/json")) return apiError("허용되지 않은 요청입니다.", 403);
  let payload: { teamId?: string; channelId?: string; messageIds?: string[] };
  try { payload = await request.json(); } catch { return apiError("요청 형식이 올바르지 않습니다."); }
  if (!payload || typeof payload.teamId !== "string" || typeof payload.channelId !== "string") return apiError("팀과 채널을 선택해 주세요.");
  try {
    const db = await persistIdentity(identity);
    if (!(await isTeamMember(db, payload.teamId, identity.id))) return apiError("팀원만 요약할 수 있습니다.", 403);
    const [channel] = await db.select().from(channels).where(and(eq(channels.id, payload.channelId), eq(channels.teamId, payload.teamId))).limit(1);
    if (!channel) return apiError("채널을 찾을 수 없습니다.", 404);
    if (!env.GEMINI_API_KEY) return Response.json({ error: "Gemini가 아직 연결되지 않았어요. 서버의 .dev.vars에 GEMINI_API_KEY를 설정해 주세요.", code: "AI_NOT_CONFIGURED" }, { status: 503 });
    if (!Array.isArray(payload.messageIds) || !payload.messageIds.length || payload.messageIds.length > 80 || payload.messageIds.some(id => typeof id !== "string" || id.length > 100)) return apiError("요약할 아이디어를 선택해 주세요.");
    const rows = await db.select({ id: messages.id, body: messages.body, parentId: messages.sourceMessageId, author: users.displayName })
      .from(messages).leftJoin(users, eq(messages.authorId, users.id))
      .where(and(eq(messages.teamId, payload.teamId), eq(messages.channelId, channel.id), eq(messages.authorType, "user"), inArray(messages.id, payload.messageIds)))
      .orderBy(desc(messages.createdAt), desc(sql`${messages}.rowid`)).limit(80);
    if (!rows.length) return apiError("아이디어를 먼저 보내 주세요.");
    // Shared persistent limit: at most three summary requests per member per minute.
    const now = Date.now();
    const key = `brainstorm:${identity.id}`;
    const [attempt] = await db.insert(authAttempts).values({ key, count: 1, expiresAt: now + 60000 })
      .onConflictDoUpdate({ target: authAttempts.key, set: {
        count: sql`CASE WHEN ${authAttempts.expiresAt} < ${now} THEN 1 ELSE ${authAttempts.count} + 1 END`,
        expiresAt: sql`CASE WHEN ${authAttempts.expiresAt} < ${now} THEN ${now + 60000} ELSE ${authAttempts.expiresAt} END`,
      } }).returning();
    if (attempt.count > 3) return apiError("요약은 1분에 3번까지 가능합니다. 잠시 후 다시 눌러 주세요.", 429);
    const recentRows = rows.reverse().slice(-30).map(row => ({ ...row, body: row.body.slice(0, 1200) }));
    const includedIds = new Set(recentRows.map(row => row.id));
    const summary = await summarizeBrainstorm({ topic: channel.name, messages: recentRows }, env.GEMINI_API_KEY, env.GEMINI_MODEL || "gemini-3.8-flash", includedIds);
    return Response.json({ summary, messageIds: recentRows.map(row => row.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    console.error("brainstorm provider error", reason || (error instanceof Error ? error.name : "unknown"));
    if (/^AI_PROVIDER_ERROR:(401|403):/.test(reason)) return apiError("Gemini API 키가 잘못됐거나 API 사용 권한이 없습니다. .dev.vars의 GEMINI_API_KEY를 확인해 주세요.", 502);
    if (/^AI_PROVIDER_ERROR:429:/.test(reason)) return apiError("Gemini API 사용 한도에 도달했습니다. Google AI Studio의 한도를 확인한 뒤 잠시 후 다시 시도해 주세요.", 429);
    if (/^AI_PROVIDER_ERROR:402:/.test(reason)) return apiError("Gemini API 결제 한도나 잔액을 확인해 주세요. Google AI Studio의 결제 설정을 확인해야 합니다.", 402);
    if (/^AI_PROVIDER_ERROR:404:/.test(reason) || reason === "AI_INVALID_MODEL") return apiError("Gemini 모델을 찾을 수 없습니다. .dev.vars의 GEMINI_MODEL을 gemini-3.8-flash로 설정해 주세요.", 502);
    if (/^AI_PROVIDER_ERROR:400:/.test(reason)) return apiError("Gemini 요청 형식이 거부됐습니다. 서버를 최신 코드로 반영하고 GEMINI_MODEL이 gemini-3.8-flash인지 확인해 주세요.", 502);
    const providerStatus = reason.match(/^AI_PROVIDER_ERROR:(\d{3}):/)?.[1];
    if (providerStatus === "500" || providerStatus === "503") return apiError(`Gemini 서버가 HTTP ${providerStatus}로 응답했습니다. 잠시 후 다시 시도해 주세요.`, 502);
    if (providerStatus) return apiError(`Gemini API가 HTTP ${providerStatus}로 요청을 거절했습니다. 키, 모델, AI Studio 프로젝트 설정을 확인해 주세요.`, 502);
    if (reason === "AI_NETWORK_ERROR:DNS") return apiError("VM이 generativelanguage.googleapis.com 주소를 찾지 못했습니다. VM DNS 설정을 확인해 주세요.", 502);
    if (reason === "AI_NETWORK_ERROR:TLS") return apiError("VM의 인증서 저장소가 Gemini HTTPS 연결을 검증하지 못했습니다. VM CA 인증서를 업데이트해 주세요.", 502);
    if (reason === "AI_NETWORK_ERROR:TIMEOUT") return apiError("VM에서 Gemini로 나가는 HTTPS 연결이 시간 초과됐습니다. 방화벽/프록시에서 generativelanguage.googleapis.com:443을 허용해 주세요.", 502);
    if (reason === "AI_NETWORK_ERROR:EGRESS") return apiError("VM에서 Gemini로 나가는 HTTPS 연결이 차단됐습니다. 방화벽/프록시에서 generativelanguage.googleapis.com:443을 허용해 주세요.", 502);
    if (reason === "AI_BLOCKED") return apiError("Gemini가 일부 대화 내용을 분석하지 못했습니다. 표현을 바꾼 뒤 다시 시도해 주세요.", 422);
    if (reason.startsWith("AI_") || error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")) return apiError("Gemini 응답에서 개념 관계를 만들지 못했습니다. 아이디어를 조금 더 추가한 뒤 다시 시도해 주세요.", 502);
    if (error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError")) return apiError("VM 서버에서 Gemini API에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.", 502);
    return apiError("AI 요약을 완료하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.", 502);
  }
}
