import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { teamMembers, users } from "../../db/schema";

export type Identity = {
  id: string;
  email: string;
  displayName: string;
};

export function readIdentity(request: Request): Identity | null {
  const id = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  if (!id || !email) return null;

  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  const fullName = request.headers.get("oai-authenticated-user-full-name-encoding");
  let displayName = email.split("@")[0] || "팀원";
  if (encodedName && fullName === "percent-encoded-utf-8") {
    try {
      displayName = decodeURIComponent(encodedName);
    } catch {
      displayName = email.split("@")[0] || "팀원";
    }
  }
  return { id, email, displayName };
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
