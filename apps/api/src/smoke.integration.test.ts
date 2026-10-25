import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { setupTestDatabase, type TestDatabaseContext } from "./test-helper.ts";

describe("PostgreSQL test infrastructure smoke test", () => {
  let ctx: TestDatabaseContext;

  beforeAll(async () => {
    ctx = await setupTestDatabase();
  });

  afterAll(async () => {
    if (ctx) {
      await ctx.cleanup();
    }
  });

  it("successfully creates and migrates a temporary test database", async () => {
    expect(ctx.testDbName).toMatch(/^event_test_\d+_\d+$/);
    const res = await ctx.pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    const tables = res.rows.map((r: { table_name: string }) => r.table_name);
    expect(tables).toEqual([
      "account",
      "events",
      "invitation",
      "member",
      "organization",
      "session",
      "user",
      "verification",
    ]);
  });
});
