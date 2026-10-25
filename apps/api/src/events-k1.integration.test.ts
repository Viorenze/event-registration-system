import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { pg } from "@event-system/db";
import { isPostgresDatabaseError, type PostgresDatabaseError } from "./db-error-helper.ts";
import { setupTestDatabase, type TestDatabaseContext } from "./test-helper.ts";

/**
 * Standard parameterized SQL template for events insertion.
 * All runtime parameters ($1 to $8) are pre-calculated in JS and passed via values array.
 * $1: organization_id, $2: title, $3: description, $4: starts_at,
 * $5: registration_deadline, $6: capacity, $7: status, $8: created_by
 */
const insertEventSql = `
  INSERT INTO events (
    organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  RETURNING id;
`;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("K1: Database Constraints Verification", () => {
  let ctx: TestDatabaseContext | undefined;
  let client: pg.PoolClient | undefined;
  let fixtureOrgId: string;
  let fixtureUserId: string;

  beforeAll(async () => {
    ctx = await setupTestDatabase();
    process.env.DATABASE_URL = ctx.testDbUrl;
    client = await ctx.pool.connect();

    // Setup valid parent fixtures
    fixtureOrgId = `k1_org_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    await client.query(
      `INSERT INTO organization (id, name, slug, created_at) VALUES ($1, $2, $3, NOW())`,
      [fixtureOrgId, "K1 Fixture Org", `k1-org-${crypto.randomUUID().slice(0, 8)}`],
    );

    fixtureUserId = `k1_user_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    await client.query(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, true, NOW(), NOW())`,
      [fixtureUserId, "K1 Fixture User", `k1_user_${crypto.randomUUID().slice(0, 8)}@example.com`],
    );

    // Verify fixtures exist
    const orgCheck = await client.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM organization WHERE id = $1`,
      [fixtureOrgId],
    );
    expect(orgCheck.rows[0].c).toBe(1);

    const userCheck = await client.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM "user" WHERE id = $1`,
      [fixtureUserId],
    );
    expect(userCheck.rows[0].c).toBe(1);
  });

  afterAll(async () => {
    if (client) {
      // Reverse dependency order cleanup
      try {
        await client.query(`DELETE FROM events WHERE organization_id = $1`, [fixtureOrgId]);
        await client.query(`DELETE FROM "user" WHERE id = $1`, [fixtureUserId]);
        await client.query(`DELETE FROM organization WHERE id = $1`, [fixtureOrgId]);
      } catch {
        // Best-effort cleanup
      }
      client.release();
    }
    if (ctx) {
      await ctx.cleanup();
    }
  });

  beforeEach(async () => {
    if (client) {
      await client.query("BEGIN");
    }
  });

  afterEach(async () => {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }
  });

  function getBaseline(baseTime: number) {
    const startsAt = new Date(baseTime + 10 * 86400000);
    const registrationDeadline = new Date(baseTime + 9 * 86400000);
    return {
      organizationId: fixtureOrgId,
      title: `k1_baseline_${baseTime}_${crypto.randomUUID().slice(0, 8)}`,
      description: "Valid baseline description",
      startsAt,
      registrationDeadline,
      capacity: 10,
      status: "open",
      createdBy: fixtureUserId,
    };
  }

  async function executeNegativeConstraintCase(opts: {
    testTitle: string;
    values: unknown[];
    expectedSqlState: string;
    expectedConstraint?: string;
    expectedColumn?: string;
  }) {
    if (!client) {
      throw new Error("Client is not initialized; K1 DML authorization required");
    }

    let caughtDbError: unknown = undefined;
    let statementSucceeded = false;

    // 1. Savepoint establishment
    await client.query("SAVEPOINT k1_case");

    try {
      // 2. Target violation SQL execution
      await client.query(insertEventSql, opts.values);
      statementSucceeded = true;
    } catch (err) {
      caughtDbError = err;
    }

    // 3. Rollback & Release executed before any assertions (no catch swallowing)
    await client.query("ROLLBACK TO SAVEPOINT k1_case");
    await client.query("RELEASE SAVEPOINT k1_case");

    // 4. Assert unexpected success did not happen
    expect(
      statementSucceeded,
      "Expected invalid SQL statement to fail with constraint violation, but it executed successfully",
    ).toBe(false);

    // 5. Runtime error structure & classification assertions
    expect(caughtDbError).toBeDefined();
    expect(
      isPostgresDatabaseError(caughtDbError),
      `Expected a Postgres DatabaseError instance, but got: ${String(caughtDbError)}`,
    ).toBe(true);

    const pgErr = caughtDbError as PostgresDatabaseError;

    // Exclude connection errors, syntax errors, auth errors, and missing table (42P01)
    expect(pgErr.code.startsWith("08"), `Connection error encountered: ${pgErr.code}`).toBe(false);
    expect(pgErr.code, `Unexpected syntax error in test query: ${pgErr.code}`).not.toBe("42601");
    expect(pgErr.code.startsWith("28"), `Authentication failure: ${pgErr.code}`).toBe(false);
    expect(
      pgErr.code,
      "Table 'events' does not exist (SQLSTATE 42P01); migration missing",
    ).not.toBe("42P01");

    // Exact SQLSTATE match
    expect(
      pgErr.code,
      `Expected constraint violation SQLSTATE ${opts.expectedSqlState}, but got ${pgErr.code}`,
    ).toBe(opts.expectedSqlState);

    // Check specific column or constraint identifier
    if (!opts.expectedConstraint && !opts.expectedColumn) {
      throw new Error(
        "Negative test specification error: must assert expectedConstraint or expectedColumn",
      );
    }
    if (opts.expectedColumn) {
      expect(pgErr.column, `Expected column '${opts.expectedColumn}', got '${pgErr.column}'`).toBe(
        opts.expectedColumn,
      );
    }
    if (opts.expectedConstraint) {
      expect(
        pgErr.constraint,
        `Expected constraint '${opts.expectedConstraint}', got '${pgErr.constraint}'`,
      ).toBe(opts.expectedConstraint);
    }

    // 6. Auxiliary check: verify row was not committed
    const checkRes = await client.query<{ c: number }>(
      "SELECT count(*)::int as c FROM events WHERE title = $1",
      [opts.testTitle],
    );
    expect(checkRes.rows[0].c).toBe(0);
  }

  // --- K1-0 Positive Controls ---

  it("K1-0a: Positive typical insert accepts valid baseline parameters and generates UUID", async () => {
    if (!client) throw new Error("Client not initialized");

    const baseTime = Date.now();
    const baseline = getBaseline(baseTime);
    const title = `k1_valid_10_${baseTime}_${crypto.randomUUID().slice(0, 8)}`;

    await client.query("SAVEPOINT k1_pos_case");
    try {
      const values: unknown[] = [
        baseline.organizationId,
        title,
        baseline.description,
        baseline.startsAt,
        baseline.registrationDeadline,
        10,
        "open",
        baseline.createdBy,
      ];
      const res = await client.query<{ id: string }>(insertEventSql, values);
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].id).toMatch(UUID_REGEX);

      const countRes = await client.query<{ c: number }>(
        "SELECT count(*)::int AS c FROM events WHERE id = $1",
        [res.rows[0].id],
      );
      expect(countRes.rows[0].c).toBe(1);
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT k1_pos_case");
      await client.query("RELEASE SAVEPOINT k1_pos_case");
    }
  });

  it("K1-0b: Positive lower bound capacity=1 is accepted", async () => {
    if (!client) throw new Error("Client not initialized");

    const baseTime = Date.now();
    const baseline = getBaseline(baseTime);
    const title = `k1_valid_1_${baseTime}_${crypto.randomUUID().slice(0, 8)}`;

    await client.query("SAVEPOINT k1_pos_case");
    try {
      const values: unknown[] = [
        baseline.organizationId,
        title,
        baseline.description,
        baseline.startsAt,
        baseline.registrationDeadline,
        1,
        "open",
        baseline.createdBy,
      ];
      const res = await client.query<{ id: string }>(insertEventSql, values);
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].id).toMatch(UUID_REGEX);

      const countRes = await client.query<{ c: number }>(
        "SELECT count(*)::int AS c FROM events WHERE id = $1",
        [res.rows[0].id],
      );
      expect(countRes.rows[0].c).toBe(1);
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT k1_pos_case");
      await client.query("RELEASE SAVEPOINT k1_pos_case");
    }
  });

  it("K1-0c: Positive upper bound capacity=1000 is accepted", async () => {
    if (!client) throw new Error("Client not initialized");

    const baseTime = Date.now();
    const baseline = getBaseline(baseTime);
    const title = `k1_valid_1000_${baseTime}_${crypto.randomUUID().slice(0, 8)}`;

    await client.query("SAVEPOINT k1_pos_case");
    try {
      const values: unknown[] = [
        baseline.organizationId,
        title,
        baseline.description,
        baseline.startsAt,
        baseline.registrationDeadline,
        1000,
        "open",
        baseline.createdBy,
      ];
      const res = await client.query<{ id: string }>(insertEventSql, values);
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].id).toMatch(UUID_REGEX);

      const countRes = await client.query<{ c: number }>(
        "SELECT count(*)::int AS c FROM events WHERE id = $1",
        [res.rows[0].id],
      );
      expect(countRes.rows[0].c).toBe(1);
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT k1_pos_case");
      await client.query("RELEASE SAVEPOINT k1_pos_case");
    }
  });

  // --- K1-1 to K1-7 Negative Constraint Controls ---

  it("K1-1: Rejects status NULL with 23502 not_null_violation", async () => {
    const baseTime = Date.now();
    const baseline = getBaseline(baseTime);
    const title = `k1_null_status_${baseTime}_${crypto.randomUUID().slice(0, 8)}`;
    const values: unknown[] = [
      baseline.organizationId,
      title,
      baseline.description,
      baseline.startsAt,
      baseline.registrationDeadline,
      10,
      null, // Single violation: status is NULL
      baseline.createdBy,
    ];

    await executeNegativeConstraintCase({
      testTitle: title,
      values,
      expectedSqlState: "23502",
      expectedColumn: "status",
    });
  });

  it("K1-2: Rejects invalid status 'draft' with 23514 check_violation (events_status_check)", async () => {
    const baseTime = Date.now();
    const baseline = getBaseline(baseTime);
    const title = `k1_bad_status_${baseTime}_${crypto.randomUUID().slice(0, 8)}`;
    const values: unknown[] = [
      baseline.organizationId,
      title,
      baseline.description,
      baseline.startsAt,
      baseline.registrationDeadline,
      10,
      "draft", // Single violation: invalid status value
      baseline.createdBy,
    ];

    await executeNegativeConstraintCase({
      testTitle: title,
      values,
      expectedSqlState: "23514",
      expectedConstraint: "events_status_check",
    });
  });

  it("K1-3: Rejects capacity=0 below lower bound with 23514 check_violation (events_capacity_check)", async () => {
    const baseTime = Date.now();
    const baseline = getBaseline(baseTime);
    const title = `k1_cap_low_${baseTime}_${crypto.randomUUID().slice(0, 8)}`;
    const values: unknown[] = [
      baseline.organizationId,
      title,
      baseline.description,
      baseline.startsAt,
      baseline.registrationDeadline,
      0, // Single violation: capacity < 1
      "open",
      baseline.createdBy,
    ];

    await executeNegativeConstraintCase({
      testTitle: title,
      values,
      expectedSqlState: "23514",
      expectedConstraint: "events_capacity_check",
    });
  });

  it("K1-4: Rejects capacity=1001 above upper bound with 23514 check_violation (events_capacity_check)", async () => {
    const baseTime = Date.now();
    const baseline = getBaseline(baseTime);
    const title = `k1_cap_high_${baseTime}_${crypto.randomUUID().slice(0, 8)}`;
    const values: unknown[] = [
      baseline.organizationId,
      title,
      baseline.description,
      baseline.startsAt,
      baseline.registrationDeadline,
      1001, // Single violation: capacity > 1000
      "open",
      baseline.createdBy,
    ];

    await executeNegativeConstraintCase({
      testTitle: title,
      values,
      expectedSqlState: "23514",
      expectedConstraint: "events_capacity_check",
    });
  });

  it("K1-5: Rejects registration_deadline > starts_at with 23514 check_violation (events_deadline_check)", async () => {
    const baseTime = Date.now();
    const baseline = getBaseline(baseTime);
    const title = `k1_bad_deadline_${baseTime}_${crypto.randomUUID().slice(0, 8)}`;
    const invalidDeadline = new Date(baseline.startsAt.getTime() + 86400000); // 1 day after starts_at
    const values: unknown[] = [
      baseline.organizationId,
      title,
      baseline.description,
      baseline.startsAt,
      invalidDeadline, // Single violation: deadline > starts_at
      10,
      "open",
      baseline.createdBy,
    ];

    await executeNegativeConstraintCase({
      testTitle: title,
      values,
      expectedSqlState: "23514",
      expectedConstraint: "events_deadline_check",
    });
  });

  it("K1-6: Rejects non-existent organization_id with 23503 foreign_key_violation (events_organization_id_organization_id_fk)", async () => {
    if (!client) throw new Error("Client not initialized");

    const baseTime = Date.now();
    const baseline = getBaseline(baseTime);
    const nonExistentOrgId = `k1_nonexistent_org_${baseTime}_${crypto.randomUUID().slice(0, 8)}`;

    // Runtime pre-check: verify ID does not exist
    const preCheck = await client.query<{ c: number }>(
      "SELECT count(*)::int AS c FROM organization WHERE id = $1",
      [nonExistentOrgId],
    );
    expect(preCheck.rows[0].c).toBe(0);

    const title = `k1_bad_org_fk_${baseTime}_${crypto.randomUUID().slice(0, 8)}`;
    const values: unknown[] = [
      nonExistentOrgId, // Single violation: non-existent org
      title,
      baseline.description,
      baseline.startsAt,
      baseline.registrationDeadline,
      10,
      "open",
      baseline.createdBy,
    ];

    await executeNegativeConstraintCase({
      testTitle: title,
      values,
      expectedSqlState: "23503",
      expectedConstraint: "events_organization_id_organization_id_fk",
    });
  });

  it("K1-7: Rejects non-existent created_by user with 23503 foreign_key_violation (events_created_by_user_id_fk)", async () => {
    if (!client) throw new Error("Client not initialized");

    const baseTime = Date.now();
    const baseline = getBaseline(baseTime);
    const nonExistentUserId = `k1_nonexistent_user_${baseTime}_${crypto.randomUUID().slice(0, 8)}`;

    // Runtime pre-check: verify ID does not exist
    const preCheck = await client.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM "user" WHERE id = $1`,
      [nonExistentUserId],
    );
    expect(preCheck.rows[0].c).toBe(0);

    const title = `k1_bad_user_fk_${baseTime}_${crypto.randomUUID().slice(0, 8)}`;
    const values: unknown[] = [
      baseline.organizationId,
      title,
      baseline.description,
      baseline.startsAt,
      baseline.registrationDeadline,
      10,
      "open",
      nonExistentUserId, // Single violation: non-existent user
    ];

    await executeNegativeConstraintCase({
      testTitle: title,
      values,
      expectedSqlState: "23503",
      expectedConstraint: "events_created_by_user_id_fk",
    });
  });
});
