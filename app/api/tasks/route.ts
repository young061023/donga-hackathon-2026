import { and, eq } from "drizzle-orm";
import { apiError, isTeamMember, newId, persistIdentity, readIdentity } from "../_lib";
import { teamMembers, tasks } from "../../../db/schema";

export async function POST(request: Request) {
  const identity = await readIdentity(request);
  if (!identity) return apiError("로그인 후 이용해 주세요.", 401);
  let payload: { teamId?: string; title?: string; assigneeId?: string | null; dueText?: string | null };
  try { payload = await request.json(); } catch { return apiError("할 일 정보가 올바르지 않습니다."); }
  const teamId = payload.teamId?.trim();
  const title = payload.title?.trim();
  if (!teamId || !title || title.length > 200) return apiError("할 일과 팀을 입력해 주세요. (200자 이내)");
  try {
    const db = await persistIdentity(identity);
    if (!(await isTeamMember(db, teamId, identity.id))) return apiError("이 팀의 할 일을 수정할 수 없습니다.", 403);
    const assigneeId = payload.assigneeId || identity.id;
    const [assignee] = await db.select({ id: teamMembers.userId }).from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, assigneeId))).limit(1);
    if (!assignee) return apiError("담당자는 팀원이어야 합니다.");
    const id = newId("task");
    await db.insert(tasks).values({ id, teamId, title, assigneeId, createdBy: identity.id, dueText: payload.dueText?.slice(0, 120) || null });
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    console.error("task create failed", error);
    return apiError("할 일을 저장하지 못했습니다.", 500);
  }
}

export async function PATCH(request: Request) {
  const identity = await readIdentity(request);
  if (!identity) return apiError("로그인 후 이용해 주세요.", 401);
  let payload: { taskId?: string; status?: string };
  try { payload = await request.json(); } catch { return apiError("할 일 정보가 올바르지 않습니다."); }
  const taskId = payload.taskId?.trim();
  const status = payload.status;
  if (!taskId || !["todo", "in_progress", "done"].includes(status ?? "")) return apiError("진행 상태가 올바르지 않습니다.");
  try {
    const db = await persistIdentity(identity);
    const [task] = await db.select({ id: tasks.id, teamId: tasks.teamId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!task || !(await isTeamMember(db, task.teamId, identity.id))) return apiError("할 일을 찾을 수 없습니다.", 404);
    await db.update(tasks).set({ status }).where(eq(tasks.id, taskId));
    return Response.json({ id: taskId, status });
  } catch (error) {
    console.error("task update failed", error);
    return apiError("할 일을 업데이트하지 못했습니다.", 500);
  }
}
