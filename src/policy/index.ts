import { headers } from "next/headers";
import { auth } from "../lib/auth";

/**
 * The single authorization layer (PRD § 2). Every server action, RSC query,
 * and route handler resolves access through here — never inline role checks.
 */

export class PolicyError extends Error {
  constructor(
    public readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = "PolicyError";
  }
}

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireUser() {
  const session = await getSession();
  if (!session) throw new PolicyError(401, "Sign in required");
  return session;
}

export async function requireOps() {
  const session = await requireUser();
  if (session.user.platformRole !== "ops_admin") {
    throw new PolicyError(403, "Ops access required");
  }
  return session;
}

// requireMembership(tenantId, capability) lands with the tenancy module (M2),
// resolving the caller's org role and checking it against org-roles.ts.
