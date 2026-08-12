import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { contactSubmissions } from "./schema";

export async function listContactSubmissions() {
  return db.query.contactSubmissions.findMany({
    orderBy: [desc(contactSubmissions.createdAt)],
    limit: 200,
  });
}

export async function countNewContactSubmissions(): Promise<number> {
  const rows = await db
    .select({ id: contactSubmissions.id })
    .from(contactSubmissions)
    .where(eq(contactSubmissions.status, "new"));
  return rows.length;
}
