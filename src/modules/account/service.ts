import { and, eq, ne } from "drizzle-orm";
import { db } from "../../db";
import { auth } from "../../lib/auth";
import { session } from "../auth/schema";

/**
 * Self-service account changes (the signed-in user on their own row).
 * Profile fields go through Better Auth's update-user so its session
 * refresh and field rules apply; sessions are deleted directly by id.
 */
export async function updateProfile(opts: {
  firstName: string;
  lastName: string;
  phone: string;
  headers: Headers;
}): Promise<void> {
  await auth.api.updateUser({
    headers: opts.headers,
    body: {
      name: `${opts.firstName} ${opts.lastName}`.trim(),
      firstName: opts.firstName,
      lastName: opts.lastName,
      phone: opts.phone,
    },
  });
}

export async function revokeOwnSession(opts: { userId: string; sessionId: string; currentSessionId: string }): Promise<void> {
  if (opts.sessionId === opts.currentSessionId) throw new Error("That's this device — use Sign out instead.");
  const rows = await db
    .delete(session)
    .where(and(eq(session.id, opts.sessionId), eq(session.userId, opts.userId)))
    .returning({ id: session.id });
  if (rows.length === 0) throw new Error("That session is already gone.");
}

export async function revokeOtherOwnSessions(opts: { userId: string; currentSessionId: string }): Promise<{ revoked: number }> {
  const rows = await db
    .delete(session)
    .where(and(eq(session.userId, opts.userId), ne(session.id, opts.currentSessionId)))
    .returning({ id: session.id });
  return { revoked: rows.length };
}
