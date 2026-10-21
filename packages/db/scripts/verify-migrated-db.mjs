// packages/db/scripts/verify-migrated-db.mjs
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPackageDir = resolve(__dirname, "..");

async function check() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("FATAL: DATABASE_URL is not set");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  try {
    const journalPath = resolve(dbPackageDir, "drizzle/meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    const expectedMigrationCount = journal.entries.length;

    // 1. Verify migration records
    const migRes = await client.query("SELECT count(*) as count FROM drizzle.__drizzle_migrations");
    const actualMigrationCount = parseInt(migRes.rows[0].count, 10);
    if (actualMigrationCount !== expectedMigrationCount) {
      throw new Error(
        `Migration record count mismatch: expected ${expectedMigrationCount} from journal, got ${actualMigrationCount}`,
      );
    }
    console.log(`✓ Migration record count matches journal entries (${actualMigrationCount})`);

    // 2. Verify all schema tables exist
    const tablesRes = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const existingTables = new Set(tablesRes.rows.map((r) => r.table_name));

    const authSchemaFile = readFileSync(resolve(dbPackageDir, "src/auth-schema.ts"), "utf8");
    const expectedTables = [];
    const tableMatches = authSchemaFile.matchAll(/export const \w+ = pgTable\(\s*"([^"]+)"/g);
    for (const m of tableMatches) {
      expectedTables.push(m[1]);
    }
    expectedTables.push("nonexistent_test_table");

    console.log(`Checking required tables: ${expectedTables.join(", ")}`);
    for (const table of expectedTables) {
      if (!existingTables.has(table)) {
        throw new Error(`Required table "${table}" is missing in migrated database!`);
      }
    }
    console.log(`✓ All ${expectedTables.length} expected schema tables exist in public schema`);
  } finally {
    await client.end();
  }
}

check().catch((err) => {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
});
