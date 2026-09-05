/**
 * Create (or promote) a durable ops_admin account. The account is created
 * with a random, never-printed password — the owner sets their real one via
 * the forgot-password flow (or signs in with magic links), so no credential
 * ever lands in the repo, chat, or shell history. Same pattern as the
 * migrated production ops users.
 *
 * Staging:
 *   railway run -p <project> -e staging -s Postgres -- \
 *     node --import tsx scripts/create-ops-admin.ts you@plaidware.com
 */
import { randomBytes } from "node:crypto";

// Compose DATABASE_URL from the Railway-injected Postgres vars (TCP proxy)
// and satisfy env validation BEFORE src/env loads (hence dynamic imports).
const { PGUSER, PGPASSWORD, RAILWAY_TCP_PROXY_DOMAIN, RAILWAY_TCP_PROXY_PORT, PGDATABASE } = process.env;
if (RAILWAY_TCP_PROXY_DOMAIN && PGUSER && PGPASSWORD && PGDATABASE) {
  process.env.DATABASE_URL = `postgresql://${PGUSER}:${PGPASSWORD}@${RAILWAY_TCP_PROXY_DOMAIN}:${RAILWAY_TCP_PROXY_PORT}/${PGDATABASE}`;
}
process.env.BETTER_AUTH_SECRET ??= "placeholder-placeholder-placeholder-32";
process.env.APP_BASE_URL ??= "https://hub-staging.plaidware.com";
// No RESEND_API_KEY in this process → email.ts logs instead of sending.

async function main() {
  const email = process.argv[2];
  if (!email?.includes("@")) throw new Error("usage: create-ops-admin.ts <email>");

  const { eq } = await import("drizzle-orm");
  const { db, pool } = await import("../src/db");
  const { user } = await import("../src/modules/auth/schema");
  const { auth } = await import("../src/lib/auth");

  const existing = await db.query.user.findFirst({ where: eq(user.email, email) });
  if (!existing) {
    await auth.api.signUpEmail({
      body: {
        email,
        password: randomBytes(24).toString("base64url"), // unknown to anyone; reset flow replaces it
        name: email.split("@")[0],
        firstName: email.split("@")[0],
        lastName: "(ops)",
        phone: "000",
      },
    });
  }
  // platformRole is input:false in the auth config — only settable here.
  await db
    .update(user)
    .set({ emailVerified: true, platformRole: "ops_admin" })
    .where(eq(user.email, email));
  console.log(
    `${email}: ${existing ? "existing account promoted to" : "created as"} ops_admin (verified). ` +
      "Set the password via the forgot-password flow, or sign in with a magic link.",
  );
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
