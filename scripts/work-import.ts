/**
 * Bulk-import work items onto a product's board from a JSON file, through the
 * work service (so numbering, ranks and item events are right). Idempotent by
 * title: an item whose title is already on the board is skipped, so re-running
 * after a partial failure never duplicates.
 *
 * Local:
 *   node --env-file=.env --import tsx scripts/work-import.ts <product-slug> <items.json> \
 *     --actor you@plaidware.com [--assignee dev@plaidware.com] [--requester <workspace slug|name|id>] [--dry-run]
 * Production (Railway Postgres TCP proxy, same as create-ops-admin.ts):
 *   railway run -p <project> -e production -s Postgres -- node --import tsx scripts/work-import.ts drivorata \
 *     scripts/data/work-drivorata-2026-09.json --actor you@plaidware.com --requester "Client name"
 *   … --list-workspaces prints every workspace (to pick a requester) and exits.
 *
 * items.json: `[ {...}, ... ]` or `{ "items": [ ... ] }`, each item a createItemSchema
 * input without boardId (title, description, type, priority, status backlog|todo,
 * labels, source, estimatePoints, dueOn).
 */
import { readFileSync } from "node:fs";

// Compose DATABASE_URL from the Railway-injected Postgres vars (TCP proxy)
// and satisfy env validation BEFORE src/env loads (hence dynamic imports).
const { PGUSER, PGPASSWORD, RAILWAY_TCP_PROXY_DOMAIN, RAILWAY_TCP_PROXY_PORT, PGDATABASE } = process.env;
if (RAILWAY_TCP_PROXY_DOMAIN && PGUSER && PGPASSWORD && PGDATABASE) {
  process.env.DATABASE_URL = `postgresql://${PGUSER}:${PGPASSWORD}@${RAILWAY_TCP_PROXY_DOMAIN}:${RAILWAY_TCP_PROXY_PORT}/${PGDATABASE}`;
}
process.env.BETTER_AUTH_SECRET ??= "placeholder-placeholder-placeholder-32";
process.env.APP_BASE_URL ??= "https://hub.plaidware.com";

type Args = {
  slug: string;
  file: string;
  actor: string;
  assignee: string | null;
  requester: string | null;
  dryRun: boolean;
  listWorkspaces: boolean;
};

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else positional.push(a);
  }
  const listWorkspaces = flags["list-workspaces"] === true;
  const [slug, file] = positional;
  if (!listWorkspaces && (!slug || !file || typeof flags.actor !== "string")) {
    throw new Error("usage: work-import.ts <product-slug> <items.json> --actor <email> [--assignee <email>] [--requester <workspace>] [--dry-run] | --list-workspaces");
  }
  return {
    slug,
    file,
    actor: typeof flags.actor === "string" ? flags.actor : "",
    assignee: typeof flags.assignee === "string" ? flags.assignee : null,
    requester: typeof flags.requester === "string" ? flags.requester : null,
    dryRun: flags["dry-run"] === true,
    listWorkspaces,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { eq, ilike, or } = await import("drizzle-orm");
  const { z } = await import("zod");
  const { db, pool } = await import("../src/db");
  const { organization, user } = await import("../src/modules/auth/schema");
  const { workItems } = await import("../src/modules/work/schema");
  const { createItemSchema } = await import("../src/modules/work/contracts");
  const svc = await import("../src/modules/work/service");
  const q = await import("../src/modules/work/queries");
  const { roleHasWorkAccess } = await import("../src/lib/roles");

  try {
    if (args.listWorkspaces) {
      const rows = await db
        .select({ id: organization.id, name: organization.name, slug: organization.slug, status: organization.status })
        .from(organization)
        .orderBy(organization.name);
      for (const r of rows) console.log(`${r.name}\t${r.slug ?? ""}\t${r.status ?? "active"}\t${r.id}`);
      console.log(`${rows.length} workspaces`);
      return;
    }

    const raw = JSON.parse(readFileSync(args.file, "utf8")) as unknown;
    const list = Array.isArray(raw) ? raw : (raw as { items?: unknown[] })?.items;
    if (!Array.isArray(list) || list.length === 0) throw new Error("items.json must be an array or { items: [...] }");

    const findUser = async (email: string) =>
      db.query.user.findFirst({
        where: eq(user.email, email.trim().toLowerCase()),
        columns: { id: true, email: true, platformRole: true, disabledAt: true },
      });
    const actor = await findUser(args.actor);
    if (!actor) throw new Error(`No account for ${args.actor}`);
    if (!roleHasWorkAccess(actor.platformRole)) throw new Error(`${actor.email} has no work-area access`);
    const assignee = args.assignee ? await findUser(args.assignee) : actor;
    if (!assignee) throw new Error(`No account for ${args.assignee}`);
    if (assignee.disabledAt) throw new Error(`${assignee.email} is disabled`);

    let requesterTenantId: string | null = null;
    if (args.requester) {
      const needle = args.requester.trim();
      const matches = await db
        .select({ id: organization.id, name: organization.name, slug: organization.slug })
        .from(organization)
        .where(or(eq(organization.id, needle), eq(organization.slug, needle), ilike(organization.name, needle)));
      if (matches.length !== 1) {
        const near =
          matches.length > 0
            ? matches
            : await db
                .select({ id: organization.id, name: organization.name, slug: organization.slug })
                .from(organization)
                .where(ilike(organization.name, `%${needle}%`));
        console.error(`Requester "${needle}" matched ${matches.length} workspaces.${near.length ? " Candidates:" : " No similar names; try --list-workspaces."}`);
        for (const c of near) console.error(`  ${c.name}\t${c.slug ?? ""}\t${c.id}`);
        process.exitCode = 2;
        return;
      }
      requesterTenantId = matches[0].id;
      console.log(`requester: ${matches[0].name} (${matches[0].slug ?? matches[0].id})`);
    }

    const ensured = await svc.ensureBoardForProductSlug(args.slug);
    if (!ensured) throw new Error(`No product with slug "${args.slug}"`);
    const board = await q.getBoardBySlug(args.slug);
    if (!board) throw new Error(`Board for "${args.slug}" could not be read`);
    console.log(
      `board ${board.keyPrefix} (${board.product.name}) mode=${board.mode} activeSprint=${board.activeSprint?.name ?? "none"} open=${board.counts.open} backlog=${board.counts.backlog}`,
    );

    const existing = new Set(
      (await db.select({ title: workItems.title }).from(workItems).where(eq(workItems.boardId, ensured.board.id))).map((r) =>
        r.title.trim().toLowerCase(),
      ),
    );
    const parsed = z
      .array(createItemSchema)
      .parse(list.map((it) => ({ ...(it as Record<string, unknown>), boardId: ensured.board.id })));
    const pending = parsed.filter((p) => !existing.has(p.title.trim().toLowerCase()));
    console.log(
      `${parsed.length} item${parsed.length === 1 ? "" : "s"} in file · ${parsed.length - pending.length} already on the board · ${pending.length} to create${args.dryRun ? " (dry run, nothing written)" : ""}`,
    );
    for (const p of pending) console.log(`  · [${p.type} · ${p.priority} · ${p.status}] ${p.title}`);
    console.log(`actor=${actor.email} assignee=${assignee.email} requester=${requesterTenantId ?? "none"}`);
    if (args.dryRun) return;

    for (const p of pending) {
      const r = await svc.createItem({ ...p, reporterUserId: actor.id, assigneeUserId: assignee.id, requesterTenantId });
      console.log(`created ${r.key}: ${p.title}`);
    }
    const after = await q.getBoardBySlug(args.slug);
    if (after) console.log(`board ${after.keyPrefix}: open=${after.counts.open} backlog=${after.counts.backlog}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
