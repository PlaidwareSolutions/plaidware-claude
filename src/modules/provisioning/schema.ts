import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { subscriptions } from "../billing/schema";
import { user } from "../auth/schema";

/** 1:1 provisioning surface per subscription (PRD §4.7). */
export const subscriptionProvisioning = pgTable(
  "subscription_provisioning",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    /** The tenant's live domain, e.g. https://acme.com */
    domainUrl: text("domain_url"),
    /** TXT-mode ownership token: DNS must carry `plaidware-verify=<token>`. */
    verifyToken: text("verify_token"),
    /** Configurable targets (Replit edge IPs are dead — PRD §4.7). */
    expectedCname: text("expected_cname"),
    expectedAIps: text("expected_a_ips"), // comma-separated
    dnsLastVerifiedAt: timestamp("dns_last_verified_at"),
    dnsLastResolved: text("dns_last_resolved"),
    dnsLastOk: boolean("dns_last_ok"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("subscription_provisioning_sub_uidx").on(t.subscriptionId)],
);

export const credentialKind = pgEnum("credential_kind", [
  "registrar",
  "dns",
  "email",
  "hosting",
  "other",
]);

/** Ops-held credentials, AES-GCM encrypted at rest (PRD §4.7). */
export const provisioningCredentials = pgTable("provisioning_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  subscriptionId: uuid("subscription_id")
    .notNull()
    .references(() => subscriptions.id, { onDelete: "cascade" }),
  kind: credentialKind("kind").notNull(),
  label: text("label").notNull(),
  url: text("url"),
  username: text("username"),
  secretCiphertext: text("secret_ciphertext"),
  createdByUserId: text("created_by_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
