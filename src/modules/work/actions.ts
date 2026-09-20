"use server";

import { refresh, revalidatePath } from "next/cache";
import { z } from "zod";
import { revalidateClientViews, revalidateWorkViews } from "@/lib/ops-revalidate";
import { WORK } from "@/lib/routes";
import { isOps, requireOps, requireWork, requireWorkManage } from "../../policy";
import {
  assignItemSchema,
  boardSettingsSchema,
  commentSchema,
  completeSprintSchema,
  createItemSchema,
  createSprintSchema,
  editCommentSchema,
  moveItemSchema,
  setItemRequesterSchema,
  setItemSprintSchema,
  updateItemSchema,
  updateSprintSchema,
  type BoardSettingsInput,
  type CompleteSprintInput,
  type CreateItemInput,
  type CreateSprintInput,
  type MoveItemInput,
  type UpdateItemInput,
  type UpdateSprintInput,
  type WorkItemStatus,
} from "./contracts";
import * as svc from "./service";

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
    const p = moveItemSchema.parse(input);
    const r = await svc.moveItem({ ...p, actorUserId: session.user.id });
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
    const r = await svc.addComment({ ...p, authorUserId: session.user.id });
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
