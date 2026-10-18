/**
 * View-as (read-only impersonation) smoke: local DB, no dev server, no mail.
 * Drives the real plugin (src/lib/impersonation-plugin.ts) through auth.api
 * and auth.handler: start, the one-hour cap that use never extends, nesting
 * and ops-admin targets refused, the HTTP surface (start is 404, writes are
 * 403, get-session exposes impersonatedBy), stop restoring the admin, and
 * sign-out while viewing ending the admin's own session. Fixtures are
 * @example.com accounts, deleted at the end.
 *
 * Run: node --env-file=.env --import tsx scripts/smoke-impersonation.ts
 */
// Never mail the fixtures (env is read when src/env loads, hence the dynamic imports).
delete process.env.RESEND_API_KEY;

function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`✗ ${msg}`);
  console.log(`✓ ${msg}`);
}

async function rejects(fn: () => Promise<unknown>, re: RegExp, msg: string) {
  try {
    await fn();
  } catch (e) {
    const text = e instanceof Error ? `${e.message} ${JSON.stringify((e as { body?: unknown }).body ?? "")}` : String(e);
    check(re.test(text), `${msg} (${text.slice(0, 80)})`);
    return;
  }
  throw new Error(`✗ ${msg}: did not throw`);
}

async function main() {
  const { eq, inArray, sql } = await import("drizzle-orm");
  const { parseSetCookieHeader, toCookieOptions } = await import("better-auth/cookies");
  const { db, pool } = await import("../src/db");
  const { session, user } = await import("../src/modules/auth/schema");
  const { auditLogs } = await import("../src/modules/audit/schema");
  const { auth } = await import("../src/lib/auth");
  const { IMPERSONATION_TTL_SECONDS, IMPERSONATOR_COOKIE, READ_ONLY_IMPERSONATION_CODE } = await import("../src/lib/impersonation-plugin");
  const { setPlatformRole } = await import("../src/modules/access/service");

  const base = process.env.APP_BASE_URL!;
  const prefix = process.env.COOKIE_PREFIX ?? "better-auth";
  const stamp = Date.now().toString(36);
  const password = `smoke-view-as-${stamp}`;

  async function mkUser(tag: string) {
    const email = `smoke-viewas-${tag}-${stamp}@example.com`;
    await auth.api.signUpEmail({
      body: { email, password, name: `Smoke ${tag}`, firstName: "Smoke", lastName: tag, phone: "000" },
    });
    await db.update(user).set({ emailVerified: true }).where(eq(user.email, email));
    const u = await db.query.user.findFirst({ where: eq(user.email, email), columns: { id: true, email: true } });
    if (!u) throw new Error(`signup failed for ${email}`);
    return u;
  }

  // A cookie jar the way a browser keeps one: later Set-Cookie wins, expired ones drop out.
  const jar = new Map<string, string>();
  function absorb(h: Headers) {
    const raw = h.get("set-cookie");
    if (!raw) return;
    parseSetCookieHeader(raw).forEach((v, name) => {
      if (!name) return;
      const o = toCookieOptions(v);
      const gone = (o.maxAge !== undefined && o.maxAge <= 0) || (o.expires && new Date(o.expires).getTime() <= Date.now());
      if (gone || !v.value) jar.delete(name);
      else jar.set(name, v.value);
    });
  }
  const hdrs = () => new Headers({ cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") });
  const http = (path: string, init: { method?: string; body?: unknown } = {}) =>
    auth.handler(
      new Request(`${base}/api/auth${path}`, {
        method: init.method ?? "GET",
        headers: { cookie: hdrs().get("cookie") ?? "", origin: base, "content-type": "application/json" },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      }),
    );

  const admin = await mkUser("admin");
  const customer = await mkUser("customer");
  const other = await mkUser("admin2");
  await setPlatformRole({ userId: admin.id, role: "ops_admin", actorUserId: null });
  await setPlatformRole({ userId: other.id, role: "ops_admin", actorUserId: null });
  const ids = [admin.id, customer.id, other.id];

  try {
    const signIn = await auth.api.signInEmail({ body: { email: admin.email, password }, returnHeaders: true });
    absorb(signIn.headers);
    const me = await auth.api.getSession({ headers: hdrs() });
    check(me?.user.id === admin.id, "admin signed in");

    // ---- start
    const start = await auth.api.startImpersonation({ headers: hdrs(), body: { userId: customer.id }, returnHeaders: true });
    absorb(start.headers);
    check(start.response.user.id === customer.id, "start returns the target");
    check(jar.has(`${prefix}.${IMPERSONATOR_COOKIE}`), "admin token stashed in the impersonator cookie");
    const viewing = await auth.api.getSession({ headers: hdrs() });
    check(viewing?.user.id === customer.id, "the browser's cookie now resolves to the customer");
    check(viewing.session.impersonatedBy === admin.id, "session.impersonatedBy names the admin");
    const ttl = (new Date(viewing.session.expiresAt).getTime() - Date.now()) / 1000;
    check(ttl > IMPERSONATION_TTL_SECONDS - 120 && ttl <= IMPERSONATION_TTL_SECONDS + 5, `view-as session expires in ~1h (${Math.round(ttl)}s)`);
    const row = await db.query.session.findFirst({ where: eq(session.id, viewing.session.id) });
    check(row?.impersonatedBy === admin.id, "impersonated_by is on the session row");
    const again = await auth.api.getSession({ headers: hdrs() });
    check(again?.session.expiresAt.getTime() === viewing.session.expiresAt.getTime(), "a second read does not extend the hour");
    check(await db.query.session.findFirst({ where: eq(session.id, me.session.id) }), "the admin's own session row survives");

    // ---- refusals
    await rejects(
      () => auth.api.startImpersonation({ headers: hdrs(), body: { userId: other.id } }),
      /Stop viewing|FORBIDDEN/i,
      "nesting is refused",
    );
    const r404 = await http("/impersonation/start", { method: "POST", body: { userId: other.id } });
    check(r404.status === 404, `POST /api/auth/impersonation/start over HTTP is 404 (got ${r404.status})`);
    const r403 = await http("/change-password", { method: "POST", body: { currentPassword: password, newPassword: `${password}x` } });
    const r403Body = (await r403.json()) as { code?: string };
    check(r403.status === 403 && r403Body.code === READ_ONLY_IMPERSONATION_CODE, `POST /api/auth/change-password while viewing is 403 ${READ_ONLY_IMPERSONATION_CODE} (got ${r403.status} ${r403Body.code})`);
    const rRevoke = await http("/revoke-sessions", { method: "POST", body: {} });
    check(rRevoke.status === 403, `POST /api/auth/revoke-sessions while viewing is 403 (got ${rRevoke.status})`);
    const rGet = await http("/get-session");
    const gs = (await rGet.json()) as { session?: { impersonatedBy?: string } };
    check(rGet.status === 200 && gs.session?.impersonatedBy === admin.id, "GET /api/auth/get-session exposes impersonatedBy (MHub contract)");

    // ---- stop
    const stop = await auth.api.stopImpersonation({ headers: hdrs(), returnHeaders: true });
    check(stop.response.restored === true, "stop restores the admin");
    absorb(stop.headers);
    const back = await auth.api.getSession({ headers: hdrs() });
    check(back?.user.id === admin.id && back.session.id === me.session.id, "the cookie resolves to the admin's original session again");
    check(!jar.has(`${prefix}.${IMPERSONATOR_COOKIE}`), "stash cookie is gone");
    check(!jar.has(`${prefix}.dont_remember`), "dont_remember is cleared for the restored admin");
    check(!(await db.query.session.findFirst({ where: eq(session.id, viewing.session.id) })), "view-as session row is deleted");
    await rejects(() => auth.api.stopImpersonation({ headers: hdrs() }), /not viewing/i, "stop without a view is refused");

    // ---- an ops admin can't be viewed as
    await rejects(
      () => auth.api.startImpersonation({ headers: hdrs(), body: { userId: other.id } }),
      /Ops admins can't be viewed as/i,
      "an ops admin target is refused",
    );
    await rejects(
      () => auth.api.startImpersonation({ headers: hdrs(), body: { userId: admin.id } }),
      /yourself/i,
      "viewing as yourself is refused",
    );

    // ---- sign-out while viewing ends the admin's own session too
    const start2 = await auth.api.startImpersonation({ headers: hdrs(), body: { userId: customer.id }, returnHeaders: true });
    absorb(start2.headers);
    const rOut = await http("/sign-out", { method: "POST", body: {} });
    check(rOut.status === 200, `POST /api/auth/sign-out while viewing is 200 (got ${rOut.status})`);
    absorb(rOut.headers);
    check(!(await db.query.session.findFirst({ where: eq(session.id, me.session.id) })), "sign-out while viewing also ended the admin's own session");
    check(!(await db.query.session.findFirst({ where: eq(session.id, start2.response.session.id) })), "…and the view-as session");
    check(!jar.has(`${prefix}.${IMPERSONATOR_COOKIE}`) && !jar.has(`${prefix}.session_token`), "cookie jar is clean");

    console.log("\nAll view-as smoke checks passed.");
  } finally {
    await db.delete(auditLogs).where(sql`${auditLogs.payload}->>'targetUserId' in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
    await db.delete(user).where(inArray(user.id, ids));
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
