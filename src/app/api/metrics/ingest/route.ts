import { z } from "zod";
import {
  logIngestEvent,
  processIngest,
  resolveIngestKey,
} from "@/modules/monitoring/service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  events: z
    .array(
      z.object({
        metric: z.string().min(1).max(80),
        quantity: z.number().finite().optional(),
        unit: z.string().max(20).optional(),
        timestamp: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1)
    .max(1000),
});

/**
 * The tenant-app reporting API (PRD §4.8). External contract is byte-
 * compatible with the legacy app: `x-metrics-key` (or `x-api-key`) bearer,
 * reserved keys become health rows, the rest become usage records.
 */
export async function POST(req: Request) {
  const rawKey = req.headers.get("x-metrics-key") ?? req.headers.get("x-api-key");
  if (!rawKey) {
    return Response.json({ error: "Missing x-metrics-key header" }, { status: 401 });
  }
  const sub = await resolveIngestKey(rawKey);
  if (!sub) {
    // Unknown keys are never persisted — no subscription to attribute to.
    return Response.json({ error: "Invalid or revoked key" }, { status: 401 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (e) {
    await logIngestEvent({
      subscriptionId: sub.id,
      ok: false,
      statusCode: 400,
      errorMessage: e instanceof z.ZodError ? e.issues[0]?.message : "Invalid JSON",
    });
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const result = await processIngest(sub, parsed.events);
    await logIngestEvent({
      subscriptionId: sub.id,
      ok: true,
      statusCode: 200,
      unknownKeys: result.unknownKeys,
    });
    return Response.json({ accepted: result.accepted, unknownKeys: result.unknownKeys });
  } catch (e) {
    await logIngestEvent({
      subscriptionId: sub.id,
      ok: false,
      statusCode: 500,
      errorMessage: e instanceof Error ? e.message.slice(0, 200) : "ingest failed",
    });
    return Response.json({ error: "Ingest failed" }, { status: 500 });
  }
}
