import { pool } from "@/db";

export const dynamic = "force-dynamic";

/**
 * Railway healthcheck target, and the same path the uptime prober expects
 * on tenant apps — the Hub honors its own contract.
 */
export async function GET() {
  try {
    await pool.query("select 1");
    return Response.json({ status: "ok" });
  } catch {
    return Response.json(
      { status: "degraded", db: "unreachable" },
      { status: 503 },
    );
  }
}
