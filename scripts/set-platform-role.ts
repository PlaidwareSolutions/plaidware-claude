/**
 * Set any account's platform role from the CLI (creating the account when it
 * doesn't exist yet). Generalises create-ops-admin.ts; the same access service
 * writes the role and audits it, so the Access tab's guards (last ops admin,
 * verified email) apply here too. New accounts get a random, never-printed
 * password — the person sets their own via the set-password link
 * (forgot-password flow) or signs in with a magic link.
 *
 *   node --env-file=.env --import tsx scripts/set-platform-role.ts dev@plaidware.com developer
 *
 * Staging:
 *   railway run -p <project> -e staging -s Postgres -- \
 *     node --import tsx scripts/set-platform-role.ts dev@plaidware.com developer
 */
import { randomBytes } from "node:crypto";

const { PGUSER, PGPASSWORD, RAILWAY_TCP_PROXY_DOMAIN, RAILWAY_TCP_PROXY_PORT, PGDATABASE } = process.env;
if (RAILWAY_TCP_PROXY_DOMAIN && PGUSER && PGPASSWORD && PGDATABASE) {
  process.env.DATABASE_URL = `postgresql://${PGUSER}:${PGPASSWORD}@${RAILWAY_TCP_PROXY_DOMAIN}:${RAILWAY_TCP_PROXY_PORT}/${PGDATABASE}`;
}
process.env.BETTER_AUTH_SECRET ??= "placeholder-placeholder-placeholder-32";
process.env.APP_BASE_URL ??= "https://hub-staging.plaidware.com";
// No RESEND_API_KEY in this process → email.ts logs instead of sending.

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const role = process.argv[3];
  const { PLATFORM_ROLES, isPlatformRole } = await import("../src/lib/roles");
  if (!email?.includes("@") || !isPlatformRole(role)) {
    throw new Error(`usage: set-platform-role.ts <email> <${PLATFORM_ROLES.join("|")}>`);
  }

  const { eq } = await import("drizzle-orm");
  const { db, pool } = await import("../src/db");
  const { user } = await import("../src/modules/auth/schema");
  const { auth } = await import("../src/lib/auth");
  const { setPlatformRole } = await import("../src/modules/access/service");

  let existing = await db.query.user.findFirst({ where: eq(user.email, email), columns: { id: true, platformRole: true } });
  if (!existing) {
    if (role === "customer") throw new Error(`${email}: no account exists; nothing to demote.`);
    await auth.api.signUpEmail({
      body: {
        email,
        password: randomBytes(24).toString("base64url"), // unknown to anyone; the set-password flow replaces it
        name: email.split("@")[0],
        firstName: email.split("@")[0],
        lastName: `(${role})`,
        phone: "000",
      },
    });
    await db.update(user).set({ emailVerified: true }).where(eq(user.email, email));
    existing = await db.query.user.findFirst({ where: eq(user.email, email), columns: { id: true, platformRole: true } });
    if (!existing) throw new Error("Account not found after signup");
  }
  if ((existing.platformRole ?? "customer") === role) {
    console.log(`${email}: already ${role}.`);
    await pool.end();
    return;
  }
  const r = await setPlatformRole({ userId: existing.id, role, actorUserId: null });
  console.log(
    `${email}: ${r.before} → ${r.after}${r.sessionsRevoked ? " (signed out everywhere)" : ""}. ` +
      "New accounts set a password via the forgot-password flow, or sign in with a magic link.",
  );
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
