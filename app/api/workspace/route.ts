import { asc, eq, inArray } from "drizzle-orm";
import { apiError, newId, newInviteCode, persistIdentity, readIdentity } from "../_lib";
import { channels, files, messages, pollOptions, pollVotes, polls, teamMembers, teams, tasks, users, workStatuses } from "../../../db/schema";

async function stableDefaultTeamId(userId: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId));
  const hex = [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `team_${hex.slice(0, 32)}`;
}

export async function GET(request: Request) {
  const identity = readIdentity(request);
  if (!identity) return apiError("ChatGPT 로그인 후 이용해 주세요.", 401);

  try {
    const db = await persistIdentity(identity);
    let memberships = await db.select({
      id: teams.id,
      name: teams.name,
      inviteCode: teams.inviteCode,
      role: teamMembers.role,
    }).from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teamMembers.userId, identity.id));

    if (memberships.length === 0) {
      const teamId = await stableDefaultTeamId(identity.id);
      const inviteCode = newInviteCode();
      await db.insert(teams).values({ id: teamId, name: "첫 번째 팀", ownerId: identity.id, inviteCode }).onConflictDoNothing();
      await db.insert(teamMembers).values({ teamId, userId: identity.id, role: "owner" }).onConflictDoNothing();
      await db.insert(channels).values({ id: `channel_${teamId.slice(5)}`, teamId, name: "아이디어 회의" }).onConflictDoNothing();
      memberships = await db.select({
        id: teams.id,
        name: teams.name,
        inviteCode: teams.inviteCode,
        role: teamMembers.role,
      }).from(teamMembers)
        .innerJoin(teams, eq(teams.id, teamMembers.teamId))
        .where(eq(teamMembers.userId, identity.id));
    }

    const requestedTeamId = new URL(request.url).searchParams.get("teamId");
    const team = memberships.find((row) => row.id === requestedTeamId) ?? memberships[0];
    if (!team) return apiError("팀 공간을 만들지 못했습니다. 다시 시도해 주세요.", 500);

    const [teamChannels, members, teamMessages, teamTasks, teamPolls, statusRows] = await Promise.all([
      db.select().from(channels).where(eq(channels.teamId, team.id)).orderBy(asc(channels.createdAt)),
      db.select({ id: users.id, displayName: users.displayName, email: users.email, role: teamMembers.role })
        .from(teamMembers).innerJoin(users, eq(users.id, teamMembers.userId)).where(eq(teamMembers.teamId, team.id)),
      db.select({ id: messages.id, channelId: messages.channelId, authorId: messages.authorId, authorType: messages.authorType, sourceMessageId: messages.sourceMessageId, fileId: messages.fileId, fileName: files.originalName, fileContentType: files.contentType, fileSize: files.size, body: messages.body, createdAt: messages.createdAt, authorName: users.displayName })
        .from(messages).leftJoin(users, eq(users.id, messages.authorId)).leftJoin(files, eq(files.id, messages.fileId)).where(eq(messages.teamId, team.id)).orderBy(asc(messages.createdAt)).limit(100),
      db.select({ id: tasks.id, title: tasks.title, assigneeId: tasks.assigneeId, assigneeName: users.displayName, createdBy: tasks.createdBy, status: tasks.status, dueText: tasks.dueText, sourceMessageId: tasks.sourceMessageId, createdAt: tasks.createdAt })
        .from(tasks).leftJoin(users, eq(users.id, tasks.assigneeId)).where(eq(tasks.teamId, team.id)).orderBy(asc(tasks.createdAt)),
      db.select().from(polls).where(eq(polls.teamId, team.id)).orderBy(asc(polls.createdAt)).limit(20),
      db.select().from(workStatuses).where(eq(workStatuses.teamId, team.id)),
    ]);

    const pollIds = teamPolls.map((poll) => poll.id);
    const [options, votes] = pollIds.length ? await Promise.all([
      db.select().from(pollOptions).where(inArray(pollOptions.pollId, pollIds)).orderBy(asc(pollOptions.position)),
      db.select({ pollId: pollVotes.pollId, optionId: pollVotes.optionId, userId: pollVotes.userId, userName: users.displayName })
        .from(pollVotes).innerJoin(users, eq(users.id, pollVotes.userId)).where(inArray(pollVotes.pollId, pollIds)),
    ]) : [[], []];

    return Response.json({
      currentUser: identity,
      teams: memberships,
      team: { id: team.id, name: team.name, inviteCode: team.inviteCode, role: team.role },
      channels: teamChannels,
      members,
      messages: teamMessages,
      tasks: teamTasks,
      polls: teamPolls.map((poll) => ({
        ...poll,
        options: options.filter((option) => option.pollId === poll.id).map((option) => ({
          ...option,
          votes: votes.filter((vote) => vote.optionId === option.id),
        })),
      })),
      workStatuses: statusRows,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("workspace bootstrap failed", error);
    return apiError("팀 정보를 불러오지 못했습니다.", 500);
  }
}
