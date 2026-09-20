import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "../../db";
import { session } from "../auth/schema";
import { describeUserAgent } from "@/lib/user-agent";

export type SessionRow = {
  id: string;
  current: boolean;
  device: string;
  ipAddress: string | null;
  createdAt: Date;
  /** Better Auth bumps updatedAt at most once per updateAge (a day), so this is coarse. */
  lastActiveAt: Date;
  expiresAt: Date;
};

/**
 * The signed-in user's live sessions, current device first. Read directly:
 * Better Auth's list-sessions route sits behind a freshness check that
 * rejects any session older than a day, and revoke-session wants raw tokens.
 */
export async function listOwnSessions(userId: string, currentSessionId: string): Promise<SessionRow[]> {
  const rows = await db
    .select({
      id: session.id,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      expiresAt: session.expiresAt,
    })
    .from(session)
    .where(and(eq(session.userId, userId), gt(session.expiresAt, new Date())))
    .orderBy(desc(session.updatedAt));
  return rows
    .map((r) => ({
      id: r.id,
      current: r.id === currentSessionId,
      device: describeUserAgent(r.userAgent).label,
      ipAddress: r.ipAddress || null,
      createdAt: r.createdAt,
      lastActiveAt: r.updatedAt,
      expiresAt: r.expiresAt,
    }))
    .sort((a, b) => Number(b.current) - Number(a.current));
}
