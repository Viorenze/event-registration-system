// packages/db/scripts/verify-empty-db-migration.mjs
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPackageDir = resolve(__dirname, "..");
const rootDir = resolve(dbPackageDir, "../..");

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  const envPath = resolve(rootDir, ".env");
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("DATABASE_URL=")) {
        return trimmed.slice("DATABASE_URL=".length).replace(/^["']|["']$/g, "");
      }
    }
  }
  return null;
}

async function verify() {
  const rawDbUrl = loadDatabaseUrl();
  if (!rawDbUrl) {
    console.error("FATAL: DATABASE_URL is not set and could not be loaded from .env");
    process.exit(1);
  }

  // Parse DATABASE_URL
  try {
    new URL(rawDbUrl);
  } catch (err) {
    console.error(`FATAL: Invalid DATABASE_URL: ${err.message}`);
    process.exit(1);
  }

  // Admin DB connection to create/drop temporary DB
  const adminDbUrl = new URL(rawDbUrl);
  adminDbUrl.pathname = "/postgres";

  const adminClient = new pg.Client({ connectionString: adminDbUrl.toString() });
  try {
    await adminClient.connect();
  } catch (err) {
    console.error(`FATAL: Cannot connect to PostgreSQL: ${err.message}`);
    console.error("Database is unreachable. Gate must exit non-zero without starting Docker.");
    process.exit(1);
  }

  const tempDbName = `verify_migrate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  console.log(`[1/5] Creating temporary clean database: ${tempDbName}`);
  await adminClient.query(`CREATE DATABASE "${tempDbName}"`);

  const tempDbUrl = new URL(rawDbUrl);
  tempDbUrl.pathname = `/${tempDbName}`;

  try {
    // 2. Run initial migration
    console.log(`[2/5] Running initial migration on clean database...`);
    execSync("pnpm --filter @event-system/db exec drizzle-kit migrate --config=drizzle.config.ts", {
      cwd: rootDir,
      env: { ...process.env, DATABASE_URL: tempDbUrl.toString() },
      stdio: "inherit",
    });

    // 3. Run second migration (idempotency)
    console.log(`[3/5] Running second migration for idempotency...`);
    execSync("pnpm --filter @event-system/db exec drizzle-kit migrate --config=drizzle.config.ts", {
      cwd: rootDir,
      env: { ...process.env, DATABASE_URL: tempDbUrl.toString() },
      stdio: "inherit",
    });

    // 4. Verify tables and migration records
    console.log(`[4/5] Verifying migration records and schema tables...`);
    const journalPath = resolve(dbPackageDir, "drizzle/meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    const expectedMigrationCount = journal.entries.length;

    const tempClient = new pg.Client({ connectionString: tempDbUrl.toString() });
    await tempClient.connect();

    try {
      // Check migration records count
      const migRes = await tempClient.query(
        "SELECT count(*) as count FROM drizzle.__drizzle_migrations",
      );
      const actualMigrationCount = parseInt(migRes.rows[0].count, 10);
      if (actualMigrationCount !== expectedMigrationCount) {
        throw new Error(
          `Migration record count mismatch: expected ${expectedMigrationCount} from journal, got ${actualMigrationCount}`,
        );
      }
      console.log(`  ✓ Migration record count matches journal entries (${actualMigrationCount})`);

      // Check all auth tables exist
      const tablesRes = await tempClient.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
      );
      const existingTables = new Set(tablesRes.rows.map((r) => r.table_name));

      // Dynamic expected tables based on schema files
      const schemaFiles = ["auth-schema.ts", "events-schema.ts", "registrations-schema.ts"];
      const expectedTables = [];
      for (const sf of schemaFiles) {
        const filePath = resolve(dbPackageDir, "src", sf);
        if (existsSync(filePath)) {
          const content = readFileSync(filePath, "utf8");
          const tableMatches = content.matchAll(/export const \w+ = pgTable\(\s*"([^"]+)"/g);
          for (const m of tableMatches) {
            expectedTables.push(m[1]);
          }
        }
      }

      console.log(`  Checking required tables: ${expectedTables.join(", ")}`);
      for (const table of expectedTables) {
        if (!existingTables.has(table)) {
          throw new Error(`Required table "${table}" is missing in migrated database!`);
        }
      }
      console.log(`  ✓ All ${expectedTables.length} expected schema tables exist in public schema`);
    } finally {
      await tempClient.end();
    }

    const preDiff = execSync("git status --porcelain packages/db/drizzle", {
      cwd: rootDir,
      encoding: "utf8",
    });

    // 5. Schema drift check (drizzle-kit generate) with timeout
    console.log(`[5/5] Checking schema drift with drizzle-kit generate...`);
    execSync(
      "pnpm --filter @event-system/db exec drizzle-kit generate --config=drizzle.config.ts",
      {
        cwd: rootDir,
        env: { ...process.env, DATABASE_URL: tempDbUrl.toString() },
        stdio: "inherit",
        timeout: 15000, // 15s timeout to fail fast if interactive prompt hangs
      },
    );

    // Check git diff on drizzle directory
    const postDiff = execSync("git status --porcelain packages/db/drizzle", {
      cwd: rootDir,
      encoding: "utf8",
    });
    if (postDiff !== preDiff) {
      throw new Error(`Schema drift detected! Generated changes:\n${postDiff}`);
    }
    console.log("  ✓ No schema drift detected");

    console.log("\nPASS: Empty database migration verification successful.");
  } finally {
    // Drop temporary database
    console.log(`Cleaning up temporary database: ${tempDbName}`);
    try {
      await adminClient.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${tempDbName}' AND pid <> pg_backend_pid()`,
      );
      await adminClient.query(`DROP DATABASE "${tempDbName}" WITH (FORCE)`);
    } catch (cleanErr) {
      console.warn(`Warning: failed to drop temp database: ${cleanErr.message}`);
    }
    await adminClient.end();
  }
}

verify().catch((err) => {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
});
