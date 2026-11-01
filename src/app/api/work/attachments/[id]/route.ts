import { getSession, hasWorkAccess } from "@/policy";
import { getAttachment } from "@/modules/work/queries";
import { isInlineImage } from "@/modules/work/attachment-logic";

export const dynamic = "force-dynamic";

/**
 * Images in work item descriptions and comments (<img src> needs a URL, so
 * this is the one route handler the work area has). Work-area users only —
 * read-only view-as sessions included, like the pages that show them.
 * Uploads go through uploadWorkImageAction / attachFileAction; the type was
 * checked then. Only verified images are served inline; every other file is
 * a download, so nothing an attacher uploads can render in our origin.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/work/attachments/[id]">) {
  const download = new URL(req.url).searchParams.has("download");
  const session = await getSession();
  if (!session || !hasWorkAccess(session)) return new Response("Not found", { status: 404 });
  const { id } = await ctx.params;
  const file = await getAttachment(id);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.byteSize),
      "Content-Disposition": isInlineImage(file.contentType) && !download ? "inline" : contentDisposition(file.fileName),
      // Immutable by id; private so a shared cache never serves it to someone signed out.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

/** attachment; filename=… with an ASCII fallback and the UTF-8 name (RFC 6266). */
function contentDisposition(name: string | null): string {
  const n = (name ?? "file").replace(/[\r\n"]/g, "");
  const ascii = n.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(n)}`;
}
