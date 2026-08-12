import { db, pool } from "../src/db";
import { seedCatalog } from "../src/modules/catalog/seed";

seedCatalog(db)
  .then((r) => {
    console.log(`[seed] catalog: ${r.products} products, ${r.componentsAdded} components added`);
    return pool.end();
  })
  .catch((e) => {
    console.error("[seed] failed:", e);
    process.exit(1);
  });
