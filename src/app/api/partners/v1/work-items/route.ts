import type { NextRequest } from "next/server";
import { handleMutation } from "@/modules/partners/api-http";
import { createPartnerWorkItem } from "@/modules/partners/api-service";
import { createWorkItemSchema } from "@/modules/partners/contracts";

/** Partner API v1 — POST /work-items: a user's bug report / feedback / idea becomes a ticket on the app's board. */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handleMutation(req, async ({ app, actor, body }) => {
    const r = await createPartnerWorkItem({ app, actor, body: createWorkItemSchema.parse(body) });
    return { status: r.created ? 201 : 200, body: r.ticket };
  });
}
