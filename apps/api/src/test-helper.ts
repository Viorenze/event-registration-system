import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, pg } from "@event-system/db";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPackageDir = path.resolve(__dirname, "../../../packages/db");

export interface TestDatabaseContext {
  testDbName: string;
  testDbUrl: string;
  pool: pg.Pool;
  db: ReturnType<typeof createDb>;
  cleanup: () => Promise<void>;
}

export async function setupTestDatabase(): Promise<TestDatabaseContext> {
  if (!process.env.DATABASE_URL && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile();
    } catch {}
  }

  process.env.BETTER_AUTH_SECRET ??= "test-secret-for-unit-tests-only-123456";
  process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
  process.env.TRUSTED_ORIGINS ??= "http://localhost:3000";
  process.env.LOG_LEVEL ??= "info";
  process.env.NODE_ENV ??= "test";

  const baseConnStr = process.env.DATABASE_URL;
  if (!baseConnStr) {
    throw new Error(
      "DATABASE_URL environment variable is required for integration tests, but was not found. Please provide DATABASE_URL.",
    );
  }

  let adminUrl: URL;
  try {
    adminUrl = new URL(baseConnStr);
    adminUrl.pathname = "/postgres";
  } catch (err) {
    throw new Error(
      `DATABASE_URL is not a valid URL: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const adminPool = new pg.Pool({
    connectionString: adminUrl.toString(),
    connectionTimeoutMillis: 5000,
  });

  try {
    await adminPool.query("SELECT 1");
  } catch (err) {
    await adminPool.end().catch(() => {});
    throw new Error(
      `PostgreSQL database is unreachable at ${adminUrl.host}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Clean up stale databases older than 1 hour
  try {
    const staleDbs = await adminPool.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname LIKE 'event_test_%'",
    );
    for (const row of staleDbs.rows) {
      const parts = row.datname.split("_");
      const timestamp = parseInt(parts[2], 10);
      if (timestamp && Date.now() - timestamp > 3600000) {
        await adminPool.query(`DROP DATABASE IF EXISTS "${row.datname}" WITH (FORCE)`);
      }
    }
  } catch {
    // Best-effort cleanup
  }

  const testDbName = `event_test_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const testUrl = new URL(baseConnStr);
  testUrl.pathname = `/${testDbName}`;

  try {
    await adminPool.query(`CREATE DATABASE "${testDbName}"`);
  } catch (err) {
    await adminPool.end().catch(() => {});
    throw new Error(
      `Failed to create test database ${testDbName}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Run migrations via drizzle-kit
  try {
    execSync("node ./node_modules/drizzle-kit/bin.cjs migrate --config=drizzle.config.ts", {
      cwd: dbPackageDir,
      stdio: "pipe",
      env: {
        ...process.env,
        DATABASE_URL: testUrl.toString(),
      },
    });
  } catch (err) {
    await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`).catch(() => {});
    await adminPool.end().catch(() => {});
    throw new Error(
      `Drizzle Kit migration failed for test database ${testDbName}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const pool = new pg.Pool({
    connectionString: testUrl.toString(),
    max: 10,
  });
  pool.on("error", () => {});
  const db = createDb(testUrl.toString());
  const drizzlePool = (db as unknown as { $client?: pg.Pool }).$client;
  if (drizzlePool && typeof drizzlePool.on === "function") {
    drizzlePool.on("error", () => {});
  }

  return {
    testDbName,
    testDbUrl: testUrl.toString(),
    pool,
    db,
    cleanup: async () => {
      try {
        await pool.end().catch(() => {});
        // Also close the drizzle db's pool
        const drizzlePool = (db as unknown as { $client: pg.Pool }).$client;
        if (drizzlePool && typeof drizzlePool.end === "function") {
          await drizzlePool.end().catch(() => {});
        }
        await adminPool
          .query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`)
          .catch(() => {});
      } finally {
        await adminPool.end().catch(() => {});
      }
    },
  };
}
