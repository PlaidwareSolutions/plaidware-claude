"use server";

import { refresh, revalidatePath } from "next/cache";
import { z } from "zod";
import { revalidateClientViews, revalidateWorkViews } from "@/lib/ops-revalidate";
import { WORK } from "@/lib/routes";
import { isOps, isOpsAdmin, requireOps, requireWork, requireWorkManage } from "../../policy";
import {
  addItemLinkSchema,
  assignItemSchema,
  cloneItemSchema,
  moveItemToBoardSchema,
  boardSettingsSchema,
  commentSchema,
  completeSprintSchema,
  createItemSchema,
  createSprintSchema,
  editCommentSchema,
  moveItemSchema,
  quickCreateItemSchema,
  setItemFlagSchema,
  setItemParentSchema,
  setWatchingSchema,
  setItemRequesterSchema,
  setItemSprintSchema,
  updateItemSchema,
  updateSprintSchema,
  type BoardSettingsInput,
  type CompleteSprintInput,
  type CreateItemInput,
  type CreateSprintInput,
  type MoveItemInput,
  type QuickCreateItemInput,
  type UpdateItemInput,
  type UpdateSprintInput,
  type WorkItemStatus,
} from "./contracts";
import * as svc from "./service";
import { env } from "@/env";
import { fetchLinkPreview } from "./link-preview";
import { itemTitleByRef, listMyNotifications, searchItemsForLink } from "./queries";
import { ATTACHMENT_MAX_BYTES, FILE_MAX_BYTES } from "./attachment-logic";
import type { WorkLinkTargetDto } from "./dto";
import { isRichTextEmpty } from "./rich-text";

/**
 * Policy → contract → service → revalidate → refresh(). The server-side
 * refresh() makes an optimistic kanban move and the fresh server tree land
 * in the same React transition (no flash back); client code in this module
 * therefore calls useAction() with refresh: false.
 */

type ActionResult = { ok: true } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({
  ok: false,
  error: e instanceof Error ? e.message : "Something went wrong",
});
const uuid = z.uuid();

function done(slug?: string, number?: number) {
  revalidateWorkViews(slug, number);
  refresh();
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export async function createItemAction(
  input: CreateItemInput & { requesterTenantId?: string | null },
): Promise<{ ok: true; id: string; number: number; key: string } | { ok: false; error: string }> {
  try {
    const session = await requireWork();
    const parsed = createItemSchema.parse(input);
    // Only ops may name the requesting client; anything else is dropped, never trusted.
    const requesterTenantId = isOps(session) ? (input.requesterTenantId ?? null) : null;
    const r = await svc.createItem({ ...parsed, reporterUserId: session.user.id, requesterTenantId });
    done(r.productSlug);
    if (requesterTenantId) revalidateClientViews(requesterTenantId);
    return { ok: true, id: r.id, number: r.number, key: r.key };
  } catch (e) {
    return fail(e);
  }
}

export async function quickCreateItemAction(
  input: QuickCreateItemInput & { requesterTenantId?: string | null },
): Promise<{ ok: true; id: string; number: number; key: string; productSlug: string } | { ok: false; error: string }> {
  try {
    const session = await requireWork();
    const p = quickCreateItemSchema.parse(input);
    const ensured = await svc.ensureBoardForProductSlug(p.productSlug);
    if (!ensured) throw new Error("Product not found");
    const requesterTenantId = isOps(session) ? (input.requesterTenantId ?? null) : null;
    const r = await svc.createItem({
      ...createItemSchema.parse({
        boardId: ensured.board.id,
        title: p.title,
        type: p.type,
        priority: p.priority,
        status: p.status === "backlog" ? "backlog" : "todo",
        assigneeUserId: p.assigneeUserId ?? null,
        parentId: p.parentId ?? null,
        source: requesterTenantId ? "client_request" : "internal",
      }),
      reporterUserId: session.user.id,
      requesterTenantId,
    });
    // Created in to-do, then moved: the move is what stamps started/completed and the sprint.
    if (p.status !== "backlog" && p.status !== "todo") await svc.moveItem({ itemId: r.id, status: p.status, actorUserId: session.user.id, placement: true });
    done(r.productSlug);
    if (requesterTenantId) revalidateClientViews(requesterTenantId);
    return { ok: true, id: r.id, number: r.number, key: r.key, productSlug: r.productSlug };
  } catch (e) {
    return fail(e);
  }
}

/** An image pasted, dropped or picked in the editor; returns the URL the editor inserts. */
export async function uploadWorkImageAction(form: FormData): Promise<{ ok: true; id: string; url: string } | { ok: false; error: string }> {
  try {
    const session = await requireWork();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("No image received");
    if (file.size > ATTACHMENT_MAX_BYTES) throw new Error(`Images can be up to ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB`);
    const r = await svc.addAttachment({ bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name || null, uploadedByUserId: session.user.id });
    return { ok: true, id: r.id, url: WORK.attachment(r.id) };
  } catch (e) {
    return fail(e);
  }
}

export async function updateItemAction(input: UpdateItemInput): Promise<ActionResult> {
  try {
    const session = await requireWork();
    const p = updateItemSchema.parse(input);
    const r = await svc.updateItem({ itemId: p.itemId, patch: p.patch, actorUserId: session.user.id });
    done(r.productSlug, r.number);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function moveItemAction(
  input: MoveItemInput,
): Promise<{ ok: true; rank: string; status: WorkItemStatus; sprintId: string | null } | { ok: false; error: string }> {
  try {
    const session = await requireWork();
    const { comment, ...p } = moveItemSchema.parse(input);
    const r = await svc.moveItem({ ...p, actorUserId: session.user.id });
    // The transition screen's comment (moving to Done) lands as an ordinary comment.
    if (comment && !isRichTextEmpty(comment)) await svc.addComment({ itemId: p.itemId, body: comment, authorUserId: session.user.id });
    done(r.productSlug, r.number);
    return { ok: true, rank: r.rank, status: r.status, sprintId: r.sprintId };
  } catch (e) {
    return fail(e);
  }
}

export async function assignItemAction(input: z.input<typeof assignItemSchema>): Promise<ActionResult> {
  try {
    const session = await requireWork();
    const p = assignItemSchema.parse(input);
    const r = await svc.assignItem({ ...p, actorUserId: session.user.id });
    done(r.productSlug, r.number);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setItemSprintAction(input: z.input<typeof setItemSprintSchema>): Promise<ActionResult> {
  try {
    const session = await requireWork();
    const p = setItemSprintSchema.parse(input);
    const r = await svc.setItemSprint({ ...p, actorUserId: session.user.id });
    done(r.productSlug, r.number);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Ops (any level): which client asked for this item. */
export async function setItemParentAction(input: z.input<typeof setItemParentSchema>): Promise<ActionResult> {
  try {
    const session = await requireWork();
    const p = setItemParentSchema.parse(input);
    const r = await svc.setItemParent({ ...p, actorUserId: session.user.id });
    done(r.productSlug, r.number);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setWatchingAction(input: z.input<typeof setWatchingSchema>): Promise<ActionResult> {
  try {
    const session = await requireWork();
    const p = setWatchingSchema.parse(input);
    const r = await svc.setWatching({ itemId: p.itemId, userId: session.user.id, watching: p.watching });
    done(r.productSlug, r.number);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Hover card for a link in a description/comment. A link to one of our own
 * work items shows its key and title (no fetch); anything else is fetched
 * server-side with the SSRF guards in link-preview.ts.
 */
export async function previewLinkAction(
  url: string,
): Promise<{ ok: true; preview: { url: string; title: string | null; description: string | null; siteName: string | null; image: string | null; internal?: boolean } | null } | { ok: false; error: string }> {
  try {
    await requireWork();
    const u = z.string().url().max(2000).parse(url);
    const own = new URL(env.APP_BASE_URL);
    const parsed = new URL(u);
    const m = /^\/work\/([a-z0-9-]+)\/items\/(\d+)\/?$/.exec(parsed.pathname);
    if (parsed.host === own.host && m) {
      const item = await itemTitleByRef(m[1], Number(m[2]));
      return { ok: true, preview: item ? { url: u, title: `${item.key} · ${item.title}`, description: item.status, siteName: "Plaidware Hub", image: null, internal: true } : null };
    }
    return { ok: true, preview: await fetchLinkPreview(u) };
  } catch (e) {
    return fail(e);
  }
}

export async function setItemFlagAction(input: z.input<typeof setItemFlagSchema>): Promise<ActionResult> {
  try {
    const session = await requireWork();
    const p = setItemFlagSchema.parse(input);
    const r = await svc.setItemFlag({ ...p, actorUserId: session.user.id });
    done(r.productSlug, r.number);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setItemRequesterAction(input: z.input<typeof setItemRequesterSchema>): Promise<ActionResult> {
  try {
    const session = await requireOps("support");
    const p = setItemRequesterSchema.parse(input);
    const r = await svc.setItemRequester({ ...p, actorUserId: session.user.id });
    done(r.productSlug, r.number);
    if (p.requesterTenantId) revalidateClientViews(p.requesterTenantId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteItemAction(itemId: string): Promise<ActionResult> {
  try {
    const session = await requireWorkManage();
    const r = await svc.deleteItem({ itemId: uuid.parse(itemId), actorUserId: session.user.id });
    done(r.productSlug);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export async function addCommentAction(
  input: z.input<typeof commentSchema>,
): Promise<{ ok: true; commentId: string } | { ok: false; error: string }> {
  try {
    const session = await requireWork();
    const p = commentSchema.parse(input);
    const r = await svc.addComment({ itemId: p.itemId, body: p.body, parentId: p.parentId ?? null, authorUserId: session.user.id });
    done(r.productSlug, r.number);
    return { ok: true, commentId: r.commentId };
  } catch (e) {
    return fail(e);
  }
}

export async function editCommentAction(input: z.input<typeof editCommentSchema>): Promise<ActionResult> {
  try {
    const session = await requireWork();
    const p = editCommentSchema.parse(input);
    const r = await svc.editComment({ ...p, actorUserId: session.user.id, actorIsOps: isOps(session) });
    done(r.productSlug, r.number);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteCommentAction(commentId: string): Promise<ActionResult> {
  try {
    const session = await requireWork();
    const r = await svc.deleteComment({ commentId: uuid.parse(commentId), actorUserId: session.user.id, actorIsOps: isOps(session) });
    done(r.productSlug, r.number);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Sprints
// ---------------------------------------------------------------------------

export async function createSprintAction(
  input: CreateSprintInput,
): Promise<{ ok: true; sprintId: string; number: number } | { ok: false; error: string }> {
  try {
    const session = await requireWork();
    const p = createSprintSchema.parse(input);
    const r = await svc.createSprint({ ...p, actorUserId: session.user.id });
    done(r.productSlug);
    revalidatePath(WORK.sprints(r.productSlug));
    return { ok: true, sprintId: r.sprintId, number: r.number };
  } catch (e) {
    return fail(e);
  }
}

export async function updateSprintAction(input: UpdateSprintInput): Promise<ActionResult> {
  try {
    const session = await requireWork();
    const p = updateSprintSchema.parse(input);
    const r = await svc.updateSprint({ ...p, actorUserId: session.user.id });
    done(r.productSlug);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function startSprintAction(sprintId: string): Promise<ActionResult> {
  try {
    const session = await requireWork();
    const r = await svc.startSprint({ sprintId: uuid.parse(sprintId), actorUserId: session.user.id });
    done(r.productSlug);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function completeSprintAction(
  input: CompleteSprintInput,
): Promise<{ ok: true; nextSprintId: string | null; carried: number; completedPoints: number } | { ok: false; error: string }> {
  try {
    const session = await requireWork();
    const p = completeSprintSchema.parse(input);
    const r = await svc.completeSprint({ ...p, actorUserId: session.user.id });
    done(r.productSlug);
    return { ok: true, nextSprintId: r.nextSprintId, carried: r.carried, completedPoints: r.completedPoints };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteSprintAction(sprintId: string): Promise<ActionResult> {
  try {
    const session = await requireWork();
    const r = await svc.deleteSprint({ sprintId: uuid.parse(sprintId), actorUserId: session.user.id });
    done(r.productSlug);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Board settings (ops admin)
// ---------------------------------------------------------------------------

export async function updateBoardSettingsAction(input: BoardSettingsInput): Promise<ActionResult> {
  try {
    const session = await requireWorkManage();
    const p = boardSettingsSchema.parse(input);
    const r = await svc.updateBoardSettings({ ...p, actorUserId: session.user.id });
    done(r.productSlug);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Links, clone, move, attachments
// ---------------------------------------------------------------------------

export async function addItemLinkAction(input: z.input<typeof addItemLinkSchema>): Promise<ActionResult> {
  try {
    const session = await requireWork();
    const p = addItemLinkSchema.parse(input);
    const r = await svc.addItemLink({ ...p, actorUserId: session.user.id });
    revalidateWorkViews(r.otherSlug, r.otherNumber);
    done(r.productSlug, r.number);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function removeItemLinkAction(linkId: string): Promise<ActionResult> {
  try {
    const session = await requireWork();
    const r = await svc.removeItemLink({ linkId: uuid.parse(linkId), actorUserId: session.user.id });
    for (const i of r.items) revalidateWorkViews(i.slug, i.number);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** The link picker's search: items on any board by key or title. */
export async function searchLinkTargetsAction(input: { q: string; excludeItemId: string }): Promise<{ ok: true; items: WorkLinkTargetDto[] } | { ok: false; error: string }> {
  try {
    await requireWork();
    const q = z.string().trim().max(200).parse(input.q);
    return { ok: true, items: await searchItemsForLink(q, uuid.parse(input.excludeItemId)) };
  } catch (e) {
    return fail(e);
  }
}

export async function cloneItemAction(
  input: z.input<typeof cloneItemSchema>,
): Promise<{ ok: true; slug: string; number: number; key: string } | { ok: false; error: string }> {
  try {
    const session = await requireWork();
    const p = cloneItemSchema.parse(input);
    // The client (requester) is ops-only data: a developer's clone never carries it.
    const r = await svc.cloneItem({ ...p, actorUserId: session.user.id, copyRequester: isOps(session) });
    done(r.productSlug, r.number);
    return { ok: true, slug: r.productSlug, number: r.number, key: r.key };
  } catch (e) {
    return fail(e);
  }
}

export async function moveItemToBoardAction(
  input: z.input<typeof moveItemToBoardSchema>,
): Promise<{ ok: true; slug: string; number: number; key: string } | { ok: false; error: string }> {
  try {
    const session = await requireWork();
    const p = moveItemToBoardSchema.parse(input);
    const r = await svc.moveItemToBoard({ ...p, actorUserId: session.user.id });
    revalidateWorkViews(r.fromSlug);
    done(r.slug, r.number);
    return { ok: true, slug: r.slug, number: r.number, key: r.key };
  } catch (e) {
    return fail(e);
  }
}

/** Attach one file (FormData: itemId, file) to the item's Attachments section. */
export async function attachFileAction(form: FormData): Promise<ActionResult> {
  try {
    const session = await requireWork();
    const itemId = uuid.parse(form.get("itemId"));
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("No file received");
    if (file.size > FILE_MAX_BYTES) throw new Error(`Files can be up to ${FILE_MAX_BYTES / 1024 / 1024} MB`);
    const r = await svc.attachFile({ itemId, bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name || "file", actorUserId: session.user.id });
    done(r.productSlug, r.number);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function removeAttachmentAction(attachmentId: string): Promise<ActionResult> {
  try {
    const session = await requireWork();
    const r = await svc.removeAttachment({ attachmentId: uuid.parse(attachmentId), actorUserId: session.user.id, actorIsAdmin: isOpsAdmin(session) });
    done(r.productSlug, r.number);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Card menu
// ---------------------------------------------------------------------------

export async function rankItemInColumnAction(input: { itemId: string; to: svc.ColumnMove }): Promise<ActionResult> {
  try {
    const session = await requireWork();
    const to = z.enum(["top", "up", "down", "bottom"]).parse(input.to);
    const r = await svc.rankInColumn({ itemId: uuid.parse(input.itemId), to, actorUserId: session.user.id });
    done(r.productSlug, r.number);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setItemCoverAction(input: { itemId: string; attachmentId: string | null }): Promise<ActionResult> {
  try {
    const session = await requireWork();
    const r = await svc.setItemCover({ itemId: uuid.parse(input.itemId), attachmentId: input.attachmentId ? uuid.parse(input.attachmentId) : null, actorUserId: session.user.id });
    done(r.productSlug, r.number);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Read-only: what the card menu's dialogs offer (epics, images, labels). */
export async function cardMenuDataAction(itemId: string): Promise<({ ok: true } & Awaited<ReturnType<typeof svc.cardMenuData>>) | { ok: false; error: string }> {
  try {
    await requireWork();
    return { ok: true, ...(await svc.cardMenuData(uuid.parse(itemId))) };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// The bell
// ---------------------------------------------------------------------------

/** The signed-in person's latest notifications and unread count (polled by the bell). */
export async function myNotificationsAction(): Promise<({ ok: true } & Awaited<ReturnType<typeof listMyNotifications>>) | { ok: false; error: string }> {
  try {
    const session = await requireWork();
    return { ok: true, ...(await listMyNotifications(session.user.id)) };
  } catch (e) {
    return fail(e);
  }
}

/** Read: by ids (clicked), for one item (opened), or all ("Mark all as read"). View-as sessions are refused, like every work action. */
export async function markNotificationsReadAction(input: { ids?: string[]; itemId?: string; all?: boolean }): Promise<{ ok: true; changed: number } | { ok: false; error: string }> {
  try {
    const session = await requireWork();
    const ids = input.ids ? z.array(uuid).max(100).parse(input.ids) : undefined;
    const itemId = input.itemId ? uuid.parse(input.itemId) : undefined;
    const changed = await svc.markNotificationsRead({ userId: session.user.id, ids, itemId, all: input.all === true });
    return { ok: true, changed };
  } catch (e) {
    return fail(e);
  }
}
