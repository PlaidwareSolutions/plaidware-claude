/**
 * Create or update a partner app from the command line (the same service
 * calls as Ops → System → Partners), generate its webhook secret if it has
 * none (or --rotate-secret), and mint an API key. Secrets are written to
 * --secrets-file (mode 600) as KEY=value lines for the partner's env — never
 * printed. Idempotent apart from minting a new key each run (--no-key skips).
 *
 * node --import tsx scripts/setup-partner-app.ts --name fixorata --display Fixorata \
 *   --prefix fixorata --webhook https://…/api/webhooks/plaidware-hub \
 *   --billing https://…/billing --origin https://… --origin http://localhost:4001 \
 *   --key-label fixorata-staging --secrets-file /path/secrets.env
 */
import { chmodSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { partnerApps } from "../src/modules/partners/schema";
import {
  createPartnerApp,
  mintPartnerAppKey,
  rotatePartnerWebhookSecret,
  updatePartnerApp,
} from "../src/modules/partners/service";

function args() {
  const a = process.argv.slice(2);
  const one = (k: string) => {
    const i = a.indexOf(k);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const many = (k: string) => a.flatMap((v, i) => (v === k ? [a[i + 1]] : []));
  return {
    name: one("--name"),
    display: one("--display"),
    prefixes: many("--prefix"),
    webhook: one("--webhook") ?? null,
    provision: one("--provision") ?? null,
    billing: one("--billing") ?? null,
    origins: many("--origin"),
    keyLabel: one("--key-label"),
    secretsFile: one("--secrets-file"),
    rotate: a.includes("--rotate-secret"),
    noKey: a.includes("--no-key"),
  };
}

async function main() {
  const o = args();
  if (!o.name || !o.display || o.prefixes.length === 0 || !o.secretsFile) {
    throw new Error("Required: --name --display --prefix … --secrets-file (see header)");
  }
  const input = {
    displayName: o.display,
    productPrefixes: o.prefixes,
    webhookUrl: o.webhook,
    provisionUrl: o.provision,
    billingUrl: o.billing,
    allowedReturnOrigins: o.origins,
  };
  const existing = await db.query.partnerApps.findFirst({ where: eq(partnerApps.name, o.name) });
  const id = existing ? (await updatePartnerApp(existing.id, input, null), existing.id) : await createPartnerApp({ ...input, name: o.name }, null);
  console.log(`${existing ? "updated" : "created"} partner app ${o.name} (${id})`);

  const lines: string[] = [];
  const app = (await db.query.partnerApps.findFirst({ where: eq(partnerApps.id, id) }))!;
  if (!app.webhookSecretEnc || o.rotate) {
    const secret = await rotatePartnerWebhookSecret(id, null);
    lines.push(`HUB_WEBHOOK_SECRET=${secret}`);
    console.log(`webhook secret ${app.webhookSecretEnc ? "rotated" : "generated"} (${secret.slice(0, 8)}…)`);
  } else {
    console.log("webhook secret kept (exists; pass --rotate-secret to replace)");
  }
  if (!o.noKey) {
    const key = await mintPartnerAppKey(id, o.keyLabel ?? `${o.name}-key`, null);
    lines.push(`HUB_PARTNER_KEY=${key.raw}`);
    console.log(`API key minted (${key.raw.slice(0, 12)}…)`);
  }
  writeFileSync(o.secretsFile, lines.join("\n") + (lines.length ? "\n" : ""), { mode: 0o600 });
  chmodSync(o.secretsFile, 0o600);
  console.log(`secrets → ${o.secretsFile} (${lines.length} line(s), mode 600)`);
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error("❌", e instanceof Error ? e.message : e);
    await pool.end();
    process.exit(1);
  });
