/**
 * One-off: deactivate every promo code (companion to the PROMOS_ENABLED
 * kill-switch). Run: DATABASE_URL=<url> npx tsx scripts/deactivate-promos.ts
 */
import { Client } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const client = new Client({ connectionString: url });
  await client.connect();
  const res = await client.query(
    "update promo_codes set is_active=false, auto_apply=false returning code, is_active, auto_apply",
  );
  console.log(`updated ${res.rowCount} promo rows:`);
  for (const r of res.rows) console.log(` - ${r.code}: active=${r.is_active} auto=${r.auto_apply}`);
  await client.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
