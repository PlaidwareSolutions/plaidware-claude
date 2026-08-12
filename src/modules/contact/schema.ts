import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth/schema";

/** Working lifecycle this time — the old app's status could never change (PRD §4.3). */
export const contactStatus = pgEnum("contact_status", [
  "new",
  "contacted",
  "archived",
]);

export const contactSubmissions = pgTable("contact_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  company: text("company"),
  role: text("role"),
  teamSize: text("team_size"),
  message: text("message").notNull(),
  sourcePage: text("source_page").notNull().default("contact"),
  status: contactStatus("status").notNull().default("new"),
  handledByUserId: text("handled_by_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  handledAt: timestamp("handled_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
