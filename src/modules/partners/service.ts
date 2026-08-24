import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { hashPartnerKey } from "./logic";
import { partnerKeys } from "./schema";

export async function mintPartnerKey(
  name: string,
  productPrefixes: string[],
): Promise<{ id: string; raw: string }> {
  const raw = `ppk_${randomBytes(24).toString("hex")}`;
  const [row] = await db
    .insert(partnerKeys)
    .values({
      name,
      prefix: raw.slice(0, 12),
      keyHash: hashPartnerKey(raw),
      productPrefixes,
    })
    .returning({ id: partnerKeys.id });
  return { id: row.id, raw };
}

/** The active key row for a presented raw key, or null. */
export async function resolvePartnerKey(rawKey: string) {
  const row = await db.query.partnerKeys.findFirst({
    where: and(eq(partnerKeys.keyHash, hashPartnerKey(rawKey)), isNull(partnerKeys.revokedAt)),
  });
  return row ?? null;
}

export async function revokePartnerKey(id: string): Promise<void> {
  await db
    .update(partnerKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(partnerKeys.id, id), isNull(partnerKeys.revokedAt)));
}
