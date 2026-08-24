/**
 * Mint a partner API key (X-Partner-Key) for /api/partners/subscriptions.
 * Run: node --env-file=.env --import tsx scripts/mint-partner-key.ts <name> <prefix[,prefix…]>
 * e.g. node --env-file=.env --import tsx scripts/mint-partner-key.ts mhub-staging marketing-
 */
import { pool } from "../src/db";
import { mintPartnerKey } from "../src/modules/partners/service";

async function main() {
  const [name, prefixArg] = process.argv.slice(2);
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
