import { sessionIdentity } from "../../lib/session";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { teamMembers, users } from "../../db/schema";

export type Identity = {
  id: string;
  email: string;
  displayName: string;
};

export async function readIdentity(request: Request): Promise<Identity | null> {
  return sessionIdentity(request.headers.get("cookie"));
}

export async function persistIdentity(identity: Identity) {
  const db = getDb();
  await db.insert(users).values({
    id: identity.id,
    email: identity.email,
    displayName: identity.displayName,
  }).onConflictDoUpdate({
    target: users.id,
    set: { email: identity.email, displayName: identity.displayName },
  });
  return db;
}

export async function isTeamMember(db: ReturnType<typeof getDb>, teamId: string, userId: string) {
  const [member] = await db.select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1);
  return Boolean(member);
}

export function apiError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function newInviteCode() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 12).toLowerCase();
}
