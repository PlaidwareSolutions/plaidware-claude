/**
 * Mint a partner API key (X-Partner-Key).
 *  - Feed-only key (MHub's /api/partners/subscriptions):
 *      scripts/mint-partner-key.ts <name> <prefix[,prefix…]>
 *  - Partner app key (Partner API v1, scoped to the app's prefixes):
 *      scripts/mint-partner-key.ts <name> --app <partner app name>
 * Run with: node --env-file=.env --import tsx scripts/mint-partner-key.ts …
 * (Ops → System → Partners does the same for app keys.)
 */
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { partnerApps } from "../src/modules/partners/schema";
import { mintPartnerKey } from "../src/modules/partners/service";

async function main() {
  const args = process.argv.slice(2);
  const appIdx = args.indexOf("--app");
  if (appIdx >= 0) {
    const appName = args[appIdx + 1];
    const name = args.filter((_, i) => i !== appIdx && i !== appIdx + 1)[0];
    const app = appName ? await db.query.partnerApps.findFirst({ where: eq(partnerApps.name, appName) }) : null;
    if (!name || !app) {
      console.error(`Usage: … mint-partner-key.ts <name> --app <partner app name>${appName ? ` (no app "${appName}")` : ""}`);
      process.exit(1);
    }
    const { id, raw } = await mintPartnerKey(name, app.productPrefixes, app.id);
    console.log(`Partner key "${name}" (${id}) for app ${app.name}, scoped to: ${app.productPrefixes.join(", ")}`);
    console.log(`\n  ${raw}\n`);
    console.log("Shown once — store it now (only the hash is kept).");
    return;
  }
  const [name, prefixArg] = args;
  const prefixes = prefixArg
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!name || !prefixes?.length) {
    console.error(
      "Usage: node --env-file=.env --import tsx scripts/mint-partner-key.ts <name> <prefix[,prefix…]>",
    );
    process.exit(1);
  }
  const { id, raw } = await mintPartnerKey(name, prefixes);
  console.log(`Partner key "${name}" (${id}) scoped to: ${prefixes.join(", ")}`);
  console.log(`\n  ${raw}\n`);
  console.log("Shown once — store it now (only the hash is kept).");
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error("❌", e instanceof Error ? e.message : e);
    await pool.end();
    process.exit(1);
  });
