import { and, asc, desc, eq } from "drizzle-orm";
import { apiError, isTeamMember, newId, persistIdentity, readIdentity } from "../_lib";
import { channels, messages, tasks, teamMembers, users } from "../../../db/schema";

const ideaWords = /아이디어|제안|생각|추천|만들|시도|방법|지도|기획|해보/;
const commitmentWords = [
  "하겠습니다", "하겠어요", "할게요", "할게", "해보겠습니다", "해볼게요", "해볼게",
  "맡겠습니다", "맡을게요", "맡을게", "준비하겠습니다", "준비할게요", "준비할게",
  "정리하겠습니다", "정리할게요", "정리할게", "조사하겠습니다", "조사할게요", "조사할게",
  "작성하겠습니다", "작성할게요", "작성할게", "만들겠습니다", "만들게요", "만들게",
  "보내겠습니다", "보낼게요", "보낼게", "확인하겠습니다", "확인할게요", "확인할게",
  "제출하겠습니다", "제출할게요", "제출할게", "진행하겠습니다", "진행할게요", "진행할게",
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTask(body: string, identity: { id: string }, members: Array<{ id: string; name: string }>) {
  const commitment = commitmentWords.find((word) => body.includes(word));
  if (!commitment) return null;

  const firstSentence = body.split(/[\n.!?。]/, 1)[0].trim();
  let assigneeId: string | null = null;
  let assigneeName: string | null = null;
  let taskText = firstSentence;
  const assignedMember = members
    .find((member) => {
      const name = escapeRegExp(member.name.trim().replace(/\s+/g, ""));
      return new RegExp(`(?:@)?${name}(?:님)?(?:이|가|은|는|:|：)\\s*`).test(firstSentence.replace(/\s+/g, ""));
    });

  if (assignedMember) {
    assigneeId = assignedMember.id;
    assigneeName = assignedMember.id === identity.id ? null : assignedMember.name;
    const name = escapeRegExp(assignedMember.name.trim().replace(/\s+/g, ""));
    taskText = firstSentence.replace(new RegExp(`^(?:@)?${name}(?:님)?(?:이|가|은|는|:|：)\\s*`), "");
  } else if (/(?:제가|내가|저는|나는)/.test(firstSentence)) {
    assigneeId = identity.id;
    taskText = firstSentence.replace(/^(?:저는|제가|내가|나는)\s*/, "");
  }

  const dueMatch = taskText.match(/(?:오늘|내일|모레|이번\s*주\s*[월화수목금토일]요일?|다음\s*주\s*[월화수목금토일]요일?|[월화수목금토일]요일?까지|\d{1,2}월\s*\d{1,2}일까지|\d{1,2}\/\d{1,2}까지)/);
  const dueText = dueMatch?.[0] ?? null;
  if (dueMatch) taskText = taskText.replace(dueMatch[0], " ");
  for (const word of commitmentWords) {
    taskText = taskText.replace(new RegExp(`${escapeRegExp(word)}[.!?]*$`), "");
  }
  taskText = taskText
    .replace(/^(?:그러면|그럼|제가|내가|저는|나는|이번에|제가 맡아서)\s*/, "")
    .replace(/(?:해서|하여|하고|해두고|먼저)$/g, "")
    .replace(/[\s,，:：]+$/g, "")
    .trim();
  if (taskText.length < 2) return null;

  return { title: taskText.slice(0, 180), assigneeId, assigneeName, dueText };
}

export async function POST(request: Request) {
  const identity = readIdentity(request);
  if (!identity) return apiError("ChatGPT 로그인 후 이용해 주세요.", 401);

  let payload: { teamId?: string; channelId?: string; body?: string };
  try {
    payload = await request.json();
  } catch {
    return apiError("메시지 형식이 올바르지 않습니다.");
  }

  const teamId = payload.teamId?.trim();
  const body = payload.body?.trim();
  if (!teamId || !body) return apiError("팀과 메시지를 입력해 주세요.");
  if (body.length > 2000) return apiError("메시지는 2,000자 이내로 입력해 주세요.");

  try {
    const db = await persistIdentity(identity);
    if (!(await isTeamMember(db, teamId, identity.id))) return apiError("이 팀의 대화에 접근할 수 없습니다.", 403);
    const [channel] = await db.select({ id: channels.id }).from(channels)
      .where(and(eq(channels.teamId, teamId), ...(payload.channelId ? [eq(channels.id, payload.channelId)] : [])))
      .orderBy(asc(channels.createdAt)).limit(1);
    if (!channel) return apiError("대화 채널을 찾을 수 없습니다.", 404);

    const messageId = newId("msg");
    await db.insert(messages).values({
      id: messageId,
      teamId,
      channelId: channel.id,
      authorId: identity.id,
      authorType: "user",
      body,
    });

    const members = await db.select({ id: users.id, name: users.displayName, joinedAt: teamMembers.joinedAt })
      .from(teamMembers).innerJoin(users, eq(users.id, teamMembers.userId))
      .where(eq(teamMembers.teamId, teamId)).orderBy(asc(teamMembers.joinedAt));
    const otherMembers = members.filter((member) => member.id !== identity.id);
    const inferredTask = extractTask(body, identity, members);
    if (inferredTask) {
      await db.insert(tasks).values({
        id: newId("task"),
        teamId,
        title: inferredTask.title,
        assigneeId: inferredTask.assigneeId,
        createdBy: identity.id,
        dueText: inferredTask.dueText,
        sourceMessageId: messageId,
      });
    }
    let assistantBody = "";
    let sourceMessageId: string | null = null;

    if (inferredTask) {
      assistantBody = `대화에서 할 일을 찾아 목록에 자동으로 추가했어요: “${inferredTask.title}”${inferredTask.assigneeName ? ` · ${inferredTask.assigneeName}님 담당` : inferredTask.assigneeId === identity.id ? " · 나에게 배정" : " · 담당자 미지정"}${inferredTask.dueText ? ` · ${inferredTask.dueText}` : ""}.`;
    } else if (otherMembers.length === 0) {
      assistantBody = "팀원을 초대해 주세요. 팀원이 참여하면 이름을 불러 의견을 묻고, 나온 생각을 함께 이어갈게요.";
    } else {
      const recent = await db.select({ id: messages.id, authorId: messages.authorId, authorType: messages.authorType, body: messages.body })
        .from(messages).where(eq(messages.teamId, teamId)).orderBy(desc(messages.createdAt)).limit(40);
      const ideaContribution = recent.find((message) =>
        message.authorType === "user" && message.authorId && message.authorId !== identity.id && ideaWords.test(message.body),
      );

      if (ideaContribution?.authorId) {
        const contributor = otherMembers.find((member) => member.id === ideaContribution.authorId);
        if (contributor) {
          const quote = ideaContribution.body.length > 52 ? `${ideaContribution.body.slice(0, 52)}…` : ideaContribution.body;
          assistantBody = `${contributor.name}님, 앞서 “${quote}”라고 제안해 주셨죠. 그 생각을 더 구체화한다면 무엇부터 해볼 수 있을까요?`;
          sourceMessageId = ideaContribution.id;
        }
      }

      if (!assistantBody) {
        const counts = new Map<string, number>();
        for (const message of recent) {
          if (message.authorType === "user" && message.authorId) counts.set(message.authorId, (counts.get(message.authorId) ?? 0) + 1);
        }
        const quietest = [...otherMembers].sort((a, b) =>
          (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0) || a.joinedAt.localeCompare(b.joinedAt),
        )[0];
        assistantBody = `${quietest.name}님, 이번 의견에 당신의 관점도 듣고 싶어요. 가장 중요하다고 느낀 점이나 보완할 점을 하나 들려주실래요?`;
      }
    }

    const assistantId = newId("msg");
    await db.insert(messages).values({
      id: assistantId,
      teamId,
      channelId: channel.id,
      authorId: null,
      authorType: "assistant",
      sourceMessageId,
      body: assistantBody,
    });

    const [savedUserMessage] = await db.select({ id: messages.id, channelId: messages.channelId, authorId: messages.authorId, authorType: messages.authorType, sourceMessageId: messages.sourceMessageId, body: messages.body, createdAt: messages.createdAt, authorName: users.displayName })
      .from(messages).leftJoin(users, eq(users.id, messages.authorId)).where(eq(messages.id, messageId)).limit(1);
    const [savedAssistantMessage] = await db.select({ id: messages.id, channelId: messages.channelId, authorId: messages.authorId, authorType: messages.authorType, sourceMessageId: messages.sourceMessageId, body: messages.body, createdAt: messages.createdAt, authorName: users.displayName })
      .from(messages).leftJoin(users, eq(users.id, messages.authorId)).where(eq(messages.id, assistantId)).limit(1);

    return Response.json({ messages: [savedUserMessage, savedAssistantMessage], taskAdded: Boolean(inferredTask) }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("message create failed", error);
    return apiError("메시지를 저장하지 못했습니다.", 500);
  }
}
