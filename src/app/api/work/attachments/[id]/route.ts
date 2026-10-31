import { getSession, hasWorkAccess } from "@/policy";
import { getAttachment } from "@/modules/work/queries";

export const dynamic = "force-dynamic";

/**
 * Images in work item descriptions and comments (<img src> needs a URL, so
 * this is the one route handler the work area has). Work-area users only —
 * read-only view-as sessions included, like the pages that show them.
 * Uploads go through uploadWorkImageAction; the bytes were type-checked then.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/work/attachments/[id]">) {
  const session = await getSession();
  if (!session || !hasWorkAccess(session)) return new Response("Not found", { status: 404 });
  const { id } = await ctx.params;
  const file = await getAttachment(id);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.byteSize),
      "Content-Disposition": "inline",
      // Immutable by id; private so a shared cache never serves it to someone signed out.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
