import { createHash } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { db } from "../../db";
import { IDEMPOTENCY_TTL_MS, parsePartnerActor, type PartnerActor } from "./logic";
import { partnerApps, partnerIdempotency } from "./schema";
import { hubTenantIdFor, resolvePartnerKey } from "./service";

/**
 * Route-handler glue for the Partner API v1 (docs/PARTNER-API.md): key
 * auth, actor header, tenant links, the error envelope, and the
 * Idempotency-Key ledger. Business rules live in api-service.ts.
 */

export type PartnerApp = typeof partnerApps.$inferSelect;

export type PartnerErrorCode =
  | "unauthorized"
  | "forbidden_scope"
  | "tenant_not_linked"
  | "not_found"
  | "validation_failed"
  | "workspace_locked"
  | "rejected"
  | "idempotency_conflict"
  | "payment_provider_error"
  | "internal_error";

export class PartnerApiError extends Error {
  constructor(
    readonly code: PartnerErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function partnerError(code: PartnerErrorCode, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Map anything thrown by a handler to the contract's error envelope. */
export function toErrorResponse(e: unknown): NextResponse {
  if (e instanceof PartnerApiError) return partnerError(e.code, e.message, e.status);
  if (e instanceof ZodError) {
    const issue = e.issues[0];
    return partnerError("validation_failed", issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid request", 400);
  }
  const type = (e as { type?: unknown })?.type;
  if (typeof type === "string" && type.startsWith("Stripe")) {
    console.error("[partners] stripe error:", e);
    const message = type === "StripeCardError" && e instanceof Error ? e.message : "The payment provider is unavailable — retry later";
    return partnerError("payment_provider_error", message, 502);
  }
  // Database/driver errors carry a code; never echo them.
  if (e instanceof Error && !("code" in e)) {
    return partnerError("rejected", e.message, 422);
  }
  console.error("[partners] internal error:", e);
  return partnerError("internal_error", "Something went wrong — retry later", 500);
}

/** X-Partner-Key → the active partner app it belongs to. */
export async function authenticatePartner(req: NextRequest): Promise<PartnerApp> {
  const raw = req.headers.get("x-partner-key");
  const key = raw ? await resolvePartnerKey(raw) : null;
  if (!key || !key.partnerAppId) throw new PartnerApiError("unauthorized", "Missing or invalid partner key", 401);
  const app = await db.query.partnerApps.findFirst({ where: eq(partnerApps.id, key.partnerAppId) });
  if (!app || app.status !== "active") throw new PartnerApiError("unauthorized", "This partner app is disabled", 401);
  return app;
}

/** X-Partner-Actor — required on every mutation, recorded in Hub's audit trail. */
export function requireActor(req: NextRequest): PartnerActor {
  const actor = parsePartnerActor(req.headers.get("x-partner-actor"));
  if (!actor) {
    throw new PartnerApiError(
      "validation_failed",
      "X-Partner-Actor must be JSON with external_user_id and email",
      400,
    );
  }
  return actor;
}

/** The Hub tenant linked to the partner's tenant id. */
export async function requireLinkedTenant(app: PartnerApp, externalTenantId: string): Promise<string> {
  const tenantId = await hubTenantIdFor(app.id, externalTenantId);
  if (!tenantId) throw new PartnerApiError("tenant_not_linked", "No Hub workspace is linked to this tenant", 404);
  return tenantId;
}

// ---------------------------------------------------------------------------
// Idempotency-Key ledger
// ---------------------------------------------------------------------------

type Outcome = { status: number; body: unknown };

/**
 * Run a mutation at most once per (app, Idempotency-Key). A replay with the
 * same request returns the stored response; a different request under the
 * same key is a conflict. 5xx outcomes are not stored, so a retry after a
 * transient failure runs again.
 */
export async function runIdempotent(
  app: PartnerApp,
  req: NextRequest,
  rawBody: string,
  run: () => Promise<Outcome>,
): Promise<NextResponse> {
  const key = req.headers.get("idempotency-key")?.trim();
  if (!key || key.length > 200) {
    return partnerError("validation_failed", "Idempotency-Key header is required (max 200 chars)", 400);
  }
  const requestHash = createHash("sha256")
    .update(`${req.method} ${req.nextUrl.pathname}\n${rawBody}`)
    .digest("hex");

  await db
    .delete(partnerIdempotency)
    .where(
      and(
        eq(partnerIdempotency.partnerAppId, app.id),
        eq(partnerIdempotency.key, key),
        lt(partnerIdempotency.createdAt, new Date(Date.now() - IDEMPOTENCY_TTL_MS)),
      ),
    );
  const [claimed] = await db
    .insert(partnerIdempotency)
    .values({ partnerAppId: app.id, key, requestHash })
    .onConflictDoNothing()
    .returning({ id: partnerIdempotency.id });

  if (!claimed) {
    const prior = await db.query.partnerIdempotency.findFirst({
      where: and(eq(partnerIdempotency.partnerAppId, app.id), eq(partnerIdempotency.key, key)),
    });
    if (!prior || prior.requestHash !== requestHash) {
      return partnerError("idempotency_conflict", "This Idempotency-Key was used for a different request", 409);
    }
    if (prior.responseStatus == null) {
      return partnerError("idempotency_conflict", "The original request is still being processed", 409);
    }
    return NextResponse.json(prior.responseBody, { status: prior.responseStatus });
  }

  let outcome: Outcome;
  try {
    outcome = await run();
  } catch (e) {
    const res = toErrorResponse(e);
    outcome = { status: res.status, body: await res.json() };
  }
  if (outcome.status >= 500) {
    await db.delete(partnerIdempotency).where(eq(partnerIdempotency.id, claimed.id));
  } else {
    await db
      .update(partnerIdempotency)
      .set({ responseStatus: outcome.status, responseBody: outcome.body })
      .where(eq(partnerIdempotency.id, claimed.id));
  }
  return NextResponse.json(outcome.body, { status: outcome.status });
}

/** Wrap a read handler: auth + error envelope. */
export async function handleRead(
  req: NextRequest,
  run: (app: PartnerApp) => Promise<unknown>,
): Promise<NextResponse> {
  try {
    const app = await authenticatePartner(req);
    return NextResponse.json(await run(app));
  } catch (e) {
    return toErrorResponse(e);
  }
}

/** Wrap a mutation: auth, actor, JSON body, idempotency, error envelope. */
export async function handleMutation(
  req: NextRequest,
  run: (ctx: { app: PartnerApp; actor: PartnerActor; body: unknown }) => Promise<{ status?: number; body: unknown }>,
): Promise<NextResponse> {
  let app: PartnerApp;
  let actor: PartnerActor;
  let raw: string;
  let body: unknown;
  try {
    app = await authenticatePartner(req);
    actor = requireActor(req);
    raw = await req.text();
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      throw new PartnerApiError("validation_failed", "Body must be JSON", 400);
    }
  } catch (e) {
    return toErrorResponse(e);
  }
  return runIdempotent(app, req, raw, async () => {
    const r = await run({ app, actor, body });
    return { status: r.status ?? 200, body: r.body };
  });
}
