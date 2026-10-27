import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { pg } from "@event-system/db";
import { isPostgresDatabaseError, type PostgresDatabaseError } from "./db-error-helper.ts";
import { setupTestDatabase, type TestDatabaseContext } from "./test-helper.ts";

/**
 * Parameterized SQL templates for registrations insertion.
 * Template 1 (Default): omits seq so it is assigned by identity.
 * $1: event_id, $2: organization_id, $3: user_id, $4: status
 */
const insertRegistrationSql = `
  INSERT INTO registrations (
    event_id, organization_id, user_id, status
  ) VALUES ($1, $2, $3, $4)
  RETURNING id, seq, status;
`;

/**
 * Template 2 (Explicit seq): attempts to supply explicit value for identity column.
 * $1: event_id, $2: organization_id, $3: user_id, $4: status, $5: seq
 */
const insertRegistrationWithSeqSql = `
  INSERT INTO registrations (
    event_id, organization_id, user_id, status, seq
  ) VALUES ($1, $2, $3, $4, $5)
  RETURNING id, seq, status;
`;

describe("K2: Registrations Database Constraints Verification", () => {
  let ctx: TestDatabaseContext | undefined;
  let client: pg.PoolClient | undefined;
  let fixtureOrgAId: string;
  let fixtureOrgBId: string;
  let fixtureUserAId: string;
  let fixtureUserBId: string;
  let fixtureEventAId: string;
  let fixtureEventBId: string;

  beforeAll(async () => {
    ctx = await setupTestDatabase();
    process.env.DATABASE_URL = ctx.testDbUrl;
    client = await ctx.pool.connect();

    // 1. Setup valid parent organizations (Org A and Org B)
    fixtureOrgAId = `k2_org_a_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    await client.query(
      `INSERT INTO organization (id, name, slug, created_at) VALUES ($1, $2, $3, NOW())`,
      [fixtureOrgAId, "K2 Fixture Org A", `k2-org-a-${crypto.randomUUID().slice(0, 8)}`],
    );

    fixtureOrgBId = `k2_org_b_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    await client.query(
      `INSERT INTO organization (id, name, slug, created_at) VALUES ($1, $2, $3, NOW())`,
      [fixtureOrgBId, "K2 Fixture Org B", `k2-org-b-${crypto.randomUUID().slice(0, 8)}`],
    );

    // 2. Setup valid parent users (User A and User B)
    fixtureUserAId = `k2_user_a_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    await client.query(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, true, NOW(), NOW())`,
      [
        fixtureUserAId,
        "K2 Fixture User A",
        `k2_user_a_${crypto.randomUUID().slice(0, 8)}@example.com`,
      ],
    );

    fixtureUserBId = `k2_user_b_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    await client.query(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, true, NOW(), NOW())`,
      [
        fixtureUserBId,
        "K2 Fixture User B",
        `k2_user_b_${crypto.randomUUID().slice(0, 8)}@example.com`,
      ],
    );

    // 3. Setup valid events: Event A in Org A, Event B in Org B
    fixtureEventAId = crypto.randomUUID();
    await client.query(
      `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW() + interval '10 days', NOW() + interval '5 days', 10, 'open', $5, NOW(), NOW())`,
      [fixtureEventAId, fixtureOrgAId, "K2 Event A", "Valid event in Org A", fixtureUserAId],
    );

    fixtureEventBId = crypto.randomUUID();
    await client.query(
      `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW() + interval '10 days', NOW() + interval '5 days', 10, 'open', $5, NOW(), NOW())`,
      [fixtureEventBId, fixtureOrgBId, "K2 Event B", "Valid event in Org B", fixtureUserBId],
    );
  });

  afterAll(async () => {
    if (client) {
      // Reverse dependency order cleanup: registrations -> events -> user -> organization
      try {
        await client.query(`DELETE FROM registrations WHERE organization_id IN ($1, $2)`, [
          fixtureOrgAId,
          fixtureOrgBId,
        ]);
      } catch {
        // Table may not exist yet
      }
      try {
        await client.query(`DELETE FROM events WHERE organization_id IN ($1, $2)`, [
          fixtureOrgAId,
          fixtureOrgBId,
        ]);
        await client.query(`DELETE FROM "user" WHERE id IN ($1, $2)`, [
          fixtureUserAId,
          fixtureUserBId,
        ]);
        await client.query(`DELETE FROM organization WHERE id IN ($1, $2)`, [
          fixtureOrgAId,
          fixtureOrgBId,
        ]);
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

  async function executeNegativeConstraintCase(opts: {
    testTitle: string;
    sql?: string;
    values: unknown[];
    expectedSqlState: string;
    expectedConstraint?: string;
    expectedColumn?: string;
  }) {
    if (!client) {
      throw new Error("Client is not initialized");
    }

    let caughtDbError: unknown = undefined;
    let statementSucceeded = false;

    // 1. Savepoint establishment
    await client.query("SAVEPOINT k2_case");

    try {
      // 2. Target violation SQL execution
      await client.query(opts.sql ?? insertRegistrationSql, opts.values);
      statementSucceeded = true;
    } catch (err) {
      caughtDbError = err;
    }

    // 3. Rollback & Release executed before any assertions (no catch swallowing)
    await client.query("ROLLBACK TO SAVEPOINT k2_case");
    await client.query("RELEASE SAVEPOINT k2_case");

    // 4. Assert unexpected success did not happen
    expect(
      statementSucceeded,
      `Expected invalid SQL statement to fail with constraint violation in ${opts.testTitle}, but it executed successfully`,
    ).toBe(false);

    // 5. Runtime error structure & classification assertions
    expect(caughtDbError).toBeDefined();
    expect(
      isPostgresDatabaseError(caughtDbError),
      `Expected a Postgres DatabaseError instance in ${opts.testTitle}, but got: ${String(caughtDbError)}`,
    ).toBe(true);

    const pgErr = caughtDbError as PostgresDatabaseError;

    // Exclude connection errors and syntax errors (42601)
    expect(pgErr.code.startsWith("08"), `Connection error encountered: ${pgErr.code}`).toBe(false);
    expect(pgErr.code, `Unexpected syntax error in test query: ${pgErr.code}`).not.toBe("42601");

    // 6. Assert exact SQLSTATE
    expect(
      pgErr.code,
      `SQLSTATE mismatch in ${opts.testTitle}: expected ${opts.expectedSqlState}, got ${pgErr.code} (${pgErr.message})`,
    ).toBe(opts.expectedSqlState);

    // 7. Assert constraint name if specified
    if (opts.expectedConstraint) {
      expect(
        pgErr.constraint,
        `Constraint name mismatch in ${opts.testTitle}: expected ${opts.expectedConstraint}, got ${pgErr.constraint}`,
      ).toBe(opts.expectedConstraint);
    }

    // 8. Assert column name if specified
    if (opts.expectedColumn) {
      expect(
        pgErr.column,
        `Column name mismatch in ${opts.testTitle}: expected ${opts.expectedColumn}, got ${pgErr.column}`,
      ).toBe(opts.expectedColumn);
    }
  }

  // --- K2-1: status NOT NULL check ---
  it("K2-1: rejects insertion when status is NULL with SQLSTATE 23502 (column status)", async () => {
    await executeNegativeConstraintCase({
      testTitle: "K2-1: status NULL",
      values: [fixtureEventAId, fixtureOrgAId, fixtureUserAId, null],
      expectedSqlState: "23502",
      expectedColumn: "status",
    });
  });

  // --- K2-2: status CHECK constraint ---
  it("K2-2: rejects invalid status value with SQLSTATE 23514 (constraint registrations_status_check)", async () => {
    await executeNegativeConstraintCase({
      testTitle: "K2-2: status invalid",
      values: [fixtureEventAId, fixtureOrgAId, fixtureUserAId, "invalid_status"],
      expectedSqlState: "23514",
      expectedConstraint: "registrations_status_check",
    });
  });

  // --- K2-3: Composite foreign key (event_id, organization_id) -> events (id, organization_id) ---
  it("K2-3: rejects insertion when organization_id does not match event所属 organization with SQLSTATE 23503", async () => {
    // fixtureEventAId belongs to fixtureOrgAId, but we pass fixtureOrgBId
    await executeNegativeConstraintCase({
      testTitle: "K2-3: organization_id mismatch with event",
      values: [fixtureEventAId, fixtureOrgBId, fixtureUserAId, "confirmed"],
      expectedSqlState: "23503",
      expectedConstraint: "registrations_event_org_fk",
    });
  });

  // --- K2-4: Duplicate confirmed registration for same (event_id, user_id) ---
  it("K2-4: rejects second confirmed registration for same (event_id, user_id) with SQLSTATE 23505", async () => {
    if (!client) throw new Error("Client not initialized");

    // Insert first confirmed registration (valid baseline)
    const firstRes = await client.query(insertRegistrationSql, [
      fixtureEventAId,
      fixtureOrgAId,
      fixtureUserAId,
      "confirmed",
    ]);
    expect(firstRes.rows.length).toBe(1);

    // Attempt second confirmed registration for same user and event
    await executeNegativeConstraintCase({
      testTitle: "K2-4: duplicate confirmed registration",
      values: [fixtureEventAId, fixtureOrgAId, fixtureUserAId, "confirmed"],
      expectedSqlState: "23505",
      expectedConstraint: "registrations_event_user_active_uniq",
    });
  });

  // --- K2-5: Duplicate waitlisted registration for same (event_id, user_id) ---
  it("K2-5: rejects waitlisted registration when user already has active registration with SQLSTATE 23505", async () => {
    if (!client) throw new Error("Client not initialized");

    // Insert first confirmed registration
    const firstRes = await client.query(insertRegistrationSql, [
      fixtureEventAId,
      fixtureOrgAId,
      fixtureUserAId,
      "confirmed",
    ]);
    expect(firstRes.rows.length).toBe(1);

    // Attempt second registration as waitlisted for same user and event
    await executeNegativeConstraintCase({
      testTitle: "K2-5: duplicate waitlisted registration",
      values: [fixtureEventAId, fixtureOrgAId, fixtureUserAId, "waitlisted"],
      expectedSqlState: "23505",
      expectedConstraint: "registrations_event_user_active_uniq",
    });
  });

  // --- K2-6: Control case: cancelled registration allows new active registration ---
  it("K2-6: control: allows new active registration after previous registration is marked cancelled", async () => {
    if (!client) throw new Error("Client not initialized");

    // 1. Insert first registration
    const firstRes = await client.query(insertRegistrationSql, [
      fixtureEventAId,
      fixtureOrgAId,
      fixtureUserAId,
      "confirmed",
    ]);
    expect(firstRes.rows.length).toBe(1);
    const regId1 = firstRes.rows[0].id;

    // 2. Mark first registration cancelled
    await client.query(
      `UPDATE registrations SET status = 'cancelled', cancelled_at = clock_timestamp() WHERE id = $1`,
      [regId1],
    );

    // 3. Insert second registration for the same user and event
    const secondRes = await client.query(insertRegistrationSql, [
      fixtureEventAId,
      fixtureOrgAId,
      fixtureUserAId,
      "confirmed",
    ]);
    expect(secondRes.rows.length).toBe(1);
    const regId2 = secondRes.rows[0].id;
    expect(regId2).not.toBe(regId1);

    // 4. Verify both rows exist in DB with different statuses
    const rows = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM registrations WHERE event_id = $1 AND user_id = $2 ORDER BY created_at ASC`,
      [fixtureEventAId, fixtureUserAId],
    );
    expect(rows.rows.length).toBe(2);
    expect(rows.rows[0].status).toBe("cancelled");
    expect(rows.rows[1].status).toBe("confirmed");
  });

  // --- K2-7: seq identity column constraints and auto-increment ---
  it("K2-7: rejects explicit insertion of seq (GENERATED ALWAYS) and verifies auto-increment behavior", async () => {
    if (!client) throw new Error("Client not initialized");

    // Part 1: Negative constraint - explicit seq value rejected by GENERATED ALWAYS
    await executeNegativeConstraintCase({
      testTitle: "K2-7: explicit seq rejected",
      sql: insertRegistrationWithSeqSql,
      values: [fixtureEventAId, fixtureOrgAId, fixtureUserAId, "confirmed", 9999],
      expectedSqlState: "428C9",
    });

    // Part 2: Positive sequential auto-increment without passing seq
    const res1 = await client.query(insertRegistrationSql, [
      fixtureEventAId,
      fixtureOrgAId,
      fixtureUserAId,
      "confirmed",
    ]);
    const seq1 = Number(res1.rows[0].seq);
    expect(Number.isInteger(seq1)).toBe(true);

    const res2 = await client.query(insertRegistrationSql, [
      fixtureEventAId,
      fixtureOrgAId,
      fixtureUserBId,
      "confirmed",
    ]);
    const seq2 = Number(res2.rows[0].seq);
    expect(Number.isInteger(seq2)).toBe(true);

    expect(seq2).toBeGreaterThan(seq1);
  });
});
