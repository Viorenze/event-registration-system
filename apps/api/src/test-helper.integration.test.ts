import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { pg } from "@event-system/db";
import * as testHelper from "./test-helper.ts";

function buildAdminUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.pathname = "/postgres";
  return url.toString();
}

function getOptionalShouldKeep(): (() => boolean) | undefined {
  const mod = testHelper as { shouldKeepTestDb?: () => boolean };
  return typeof mod.shouldKeepTestDb === "function" ? mod.shouldKeepTestDb : undefined;
}

describe("Test database helper keep-db support", () => {
  const originalKeepEnv = process.env.KEEP_TEST_DB;

  afterEach(() => {
    if (originalKeepEnv === undefined) {
      delete process.env.KEEP_TEST_DB;
    } else {
      process.env.KEEP_TEST_DB = originalKeepEnv;
    }
    vi.restoreAllMocks();
  });

  it("K-1: drops the temporary test database on cleanup by default", async () => {
    delete process.env.KEEP_TEST_DB;
    const ctx = await testHelper.setupTestDatabase();
    const dbName = ctx.testDbName;
    await ctx.cleanup();

    const baseUrl = process.env.DATABASE_URL;
    if (!baseUrl) {
      throw new Error("DATABASE_URL missing after setupTestDatabase");
    }
    const adminPool = new pg.Pool({
      connectionString: buildAdminUrl(baseUrl),
      connectionTimeoutMillis: 5000,
    });
    try {
      const res = await adminPool.query<{ datname: string }>(
        "SELECT datname FROM pg_database WHERE datname = $1",
        [dbName],
      );
      expect(res.rows).toHaveLength(0);
    } finally {
      await adminPool.end().catch(() => {});
    }
  });

  it("K-2: keeps database and migrations when keep=true, and checks shouldKeepTestDb", async () => {
    let dbName = "";
    let adminPool: pg.Pool | undefined;

    try {
      const setupFn = testHelper.setupTestDatabase as (options?: {
        keep?: boolean;
      }) => Promise<testHelper.TestDatabaseContext>;
      const ctx = await setupFn({ keep: true });
      dbName = ctx.testDbName;
      await ctx.cleanup();

      const baseUrl = process.env.DATABASE_URL;
      if (!baseUrl) {
        throw new Error("DATABASE_URL missing after setupTestDatabase");
      }
      adminPool = new pg.Pool({
        connectionString: buildAdminUrl(baseUrl),
        connectionTimeoutMillis: 5000,
      });

      const dbRes = await adminPool.query<{ datname: string }>(
        "SELECT datname FROM pg_database WHERE datname = $1",
        [dbName],
      );
      expect(dbRes.rows).toHaveLength(1);

      const verifyPool = new pg.Pool({
        connectionString: ctx.testDbUrl,
        connectionTimeoutMillis: 5000,
      });
      try {
        const tablesRes = await verifyPool.query<{ table_name: string }>(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
        );
        const tableNames = tablesRes.rows.map((r) => r.table_name);
        expect(tableNames).toContain("events");
        expect(tableNames).toContain("registrations");
      } finally {
        await verifyPool.end().catch(() => {});
      }

      const shouldKeepFn = getOptionalShouldKeep();
      expect(shouldKeepFn).toBeDefined();
      if (shouldKeepFn) {
        delete process.env.KEEP_TEST_DB;
        expect(shouldKeepFn()).toBe(false);
        process.env.KEEP_TEST_DB = "0";
        expect(shouldKeepFn()).toBe(false);
        process.env.KEEP_TEST_DB = "true";
        expect(shouldKeepFn()).toBe(false);
        process.env.KEEP_TEST_DB = "1";
        expect(shouldKeepFn()).toBe(true);
      }
    } finally {
      if (dbName) {
        if (!adminPool && process.env.DATABASE_URL) {
          adminPool = new pg.Pool({
            connectionString: buildAdminUrl(process.env.DATABASE_URL),
            connectionTimeoutMillis: 5000,
          });
        }
        if (adminPool) {
          await adminPool.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
          const afterRes = await adminPool.query<{ datname: string }>(
            "SELECT datname FROM pg_database WHERE datname = $1",
            [dbName],
          );
          expect(afterRes.rows).toHaveLength(0);
        }
      }
      if (adminPool) {
        await adminPool.end().catch(() => {});
      }
    }
  });

  it("K-3: logs database name without leaking connection string or password when keep=true", async () => {
    let dbName = "";
    let adminPool: pg.Pool | undefined;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const setupFn = testHelper.setupTestDatabase as (options?: {
        keep?: boolean;
      }) => Promise<testHelper.TestDatabaseContext>;
      const ctx = await setupFn({ keep: true });
      dbName = ctx.testDbName;

      await ctx.cleanup();

      const loggedLines = logSpy.mock.calls.map((args) =>
        args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "),
      );

      expect(loggedLines.some((line) => line.includes(dbName))).toBe(true);

      const parsedUrl = new URL(ctx.testDbUrl);
      const rawPassword = parsedUrl.password;
      const decodedPassword = rawPassword ? decodeURIComponent(rawPassword) : "";

      const leakedUrl = loggedLines.some((line) => line.includes(ctx.testDbUrl));
      expect(leakedUrl).toBe(false);

      if (rawPassword.length > 0) {
        const leakedPassword = loggedLines.some(
          (line) =>
            line.includes(rawPassword) ||
            (decodedPassword.length > 0 && line.includes(decodedPassword)),
        );
        expect(leakedPassword).toBe(false);
      }
    } finally {
      logSpy.mockRestore();
      if (dbName && process.env.DATABASE_URL) {
        adminPool = new pg.Pool({
          connectionString: buildAdminUrl(process.env.DATABASE_URL),
          connectionTimeoutMillis: 5000,
        });
        try {
          await adminPool.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
          const afterRes = await adminPool.query<{ datname: string }>(
            "SELECT datname FROM pg_database WHERE datname = $1",
            [dbName],
          );
          expect(afterRes.rows).toHaveLength(0);
        } finally {
          await adminPool.end().catch(() => {});
        }
      }
    }
  });
});
