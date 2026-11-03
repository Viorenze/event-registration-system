import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { createDbClient, pg } from "@event-system/db";
import { setupTestDatabase, type TestDatabaseContext } from "./test-helper.ts";
import { cancel, cancelEvent, register, updateEvent } from "./registrations.ts";
import { assertDistinctPids, waitForLockWait } from "./test-helpers/concurrency-harness.ts";

describe("C6: Time Rules, Status Transitions & Lock Interleaving Tests", () => {
  let ctx: TestDatabaseContext;
  let adminClient: pg.PoolClient;
  let fixtureOrgId: string;
  let fixtureOwnerId: string;
  let fixtureAdminId: string;

  beforeAll(async () => {
    ctx = await setupTestDatabase();
    process.env.DATABASE_URL = ctx.testDbUrl;
    adminClient = await ctx.pool.connect();

    fixtureOrgId = `tr_org_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    await adminClient.query(
      `INSERT INTO organization (id, name, slug, created_at) VALUES ($1, $2, $3, NOW())`,
      [fixtureOrgId, "Time Rules Org", `tr-org-${crypto.randomUUID().slice(0, 8)}`],
    );

    fixtureOwnerId = `tr_owner_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    await adminClient.query(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, true, NOW(), NOW())`,
      [fixtureOwnerId, "TR Owner", `tr_owner_${crypto.randomUUID().slice(0, 8)}@example.com`],
    );
    await adminClient.query(
      `INSERT INTO "member" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, 'owner', NOW())`,
      [`mem_${fixtureOwnerId}`, fixtureOrgId, fixtureOwnerId],
    );

    fixtureAdminId = `tr_admin_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    await adminClient.query(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, true, NOW(), NOW())`,
      [fixtureAdminId, "TR Admin", `tr_admin_${crypto.randomUUID().slice(0, 8)}@example.com`],
    );
    await adminClient.query(
      `INSERT INTO "member" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, 'admin', NOW())`,
      [`mem_${fixtureAdminId}`, fixtureOrgId, fixtureAdminId],
    );
  });

  afterAll(async () => {
    if (adminClient) {
      try {
        await adminClient.query(`DELETE FROM registrations WHERE organization_id = $1`, [
          fixtureOrgId,
        ]);
        await adminClient.query(`DELETE FROM events WHERE organization_id = $1`, [fixtureOrgId]);
        await adminClient.query(`DELETE FROM "member" WHERE organization_id = $1`, [fixtureOrgId]);
        await adminClient.query(`DELETE FROM "user" WHERE id IN ($1, $2)`, [
          fixtureOwnerId,
          fixtureAdminId,
        ]);
        await adminClient.query(`DELETE FROM organization WHERE id = $1`, [fixtureOrgId]);
      } catch {}
      adminClient.release();
    }
    if (ctx) {
      await ctx.cleanup();
    }
  });

  async function createUser(name: string): Promise<string> {
    const uId = `u_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
    await adminClient.query(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, true, NOW(), NOW())`,
      [uId, name, `${uId}@example.com`],
    );
    await adminClient.query(
      `INSERT INTO "member" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, 'member', NOW())`,
      [`mem_${uId}`, fixtureOrgId, uId],
    );
    return uId;
  }

  // Helper for DB snapshot
  async function getDbSnapshot(eventId: string) {
    const events = await adminClient.query(`SELECT * FROM events WHERE id = $1`, [eventId]);
    const regs = await adminClient.query(
      `SELECT * FROM registrations WHERE event_id = $1 ORDER BY id`,
      [eventId],
    );
    return { event: events.rows[0], regs: regs.rows };
  }

  // --- C6 Part 1: Registration deadline passed ---
  it("C6: after registration deadline: new registration rejected, duplicate registration returns existing, cancellation succeeds", async () => {
    const eventId = crypto.randomUUID();
    await adminClient.query(
      `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW() + interval '5 days', NOW() + interval '1 day', 2, 'open', $5, NOW(), NOW())`,
      [eventId, fixtureOrgId, "C6 Deadline Event", "Test", fixtureOwnerId],
    );

    const userExisting = await createUser("Existing Registered");
    const userWaitlisted = await createUser("Waitlisted User");
    const userNew = await createUser("New User");

    // Pre-populate before deadline
    await register(createDbClient(adminClient), fixtureOrgId, eventId, userExisting);
    await register(createDbClient(adminClient), fixtureOrgId, eventId, userWaitlisted);

    // Fast-forward registration deadline to past (starts_at remains future)
    await adminClient.query(
      `UPDATE events SET registration_deadline = NOW() - interval '10 minutes' WHERE id = $1`,
      [eventId],
    );

    // 1. New user registration rejected with REGISTRATION_CLOSED, DB unchanged
    const snapBefore = await getDbSnapshot(eventId);
    await expect(
      register(createDbClient(adminClient), fixtureOrgId, eventId, userNew),
    ).rejects.toMatchObject({ code: "REGISTRATION_CLOSED" });
    const snapAfter = await getDbSnapshot(eventId);
    expect(snapAfter).toEqual(snapBefore);

    // 2. Existing user duplicate registration returns existing registration (idempotent, BR-9)
    const dupRes = await register(createDbClient(adminClient), fixtureOrgId, eventId, userExisting);
    expect(dupRes.isCreated).toBe(false);
    expect(dupRes.registration.userId).toBe(userExisting);

    // 3. Cancel is still allowed after registration deadline, promotes waitlisted
    const cancelRes = await cancel(
      createDbClient(adminClient),
      fixtureOrgId,
      eventId,
      { me: true },
      { userId: userExisting },
    );
    expect(cancelRes).toEqual({ kind: "cancelled" });

    const waitlistedRow = await adminClient.query<{ status: string }>(
      `SELECT status FROM registrations WHERE event_id = $1 AND user_id = $2`,
      [eventId, userWaitlisted],
    );
    expect(waitlistedRow.rows[0].status).toBe("confirmed");
  });

  // --- C6 Part 2: Event started ---
  it("C6: after event started: registrations, cancellations, and capacity changes rejected with EVENT_STARTED; title update succeeds", async () => {
    const eventId = crypto.randomUUID();
    // Event started 1 hour ago
    await adminClient.query(
      `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW() - interval '1 hour', NOW() - interval '2 hours', 5, 'open', $5, NOW(), NOW())`,
      [eventId, fixtureOrgId, "C6 Started Event", "Test", fixtureOwnerId],
    );

    const user1 = await createUser("Started User 1");
    // Insert a confirmed registration directly via SQL fixture
    const regId = crypto.randomUUID();
    await adminClient.query(
      `INSERT INTO registrations (id, event_id, organization_id, user_id, status, created_at)
       VALUES ($1, $2, $3, $4, 'confirmed', NOW())`,
      [regId, eventId, fixtureOrgId, user1],
    );

    const user2 = await createUser("Started User 2");

    // 1. New registration -> EVENT_STARTED, DB unchanged
    const snap1 = await getDbSnapshot(eventId);
    await expect(
      register(createDbClient(adminClient), fixtureOrgId, eventId, user2),
    ).rejects.toMatchObject({ code: "EVENT_STARTED" });
    expect(await getDbSnapshot(eventId)).toEqual(snap1);

    // 2. Duplicate registration -> EVENT_STARTED, DB unchanged
    await expect(
      register(createDbClient(adminClient), fixtureOrgId, eventId, user1),
    ).rejects.toMatchObject({ code: "EVENT_STARTED" });
    expect(await getDbSnapshot(eventId)).toEqual(snap1);

    // 3. Cancel registration -> EVENT_STARTED, DB unchanged
    await expect(
      cancel(createDbClient(adminClient), fixtureOrgId, eventId, { me: true }, { userId: user1 }),
    ).rejects.toMatchObject({ code: "EVENT_STARTED" });
    expect(await getDbSnapshot(eventId)).toEqual(snap1);

    // 4. Update capacity -> EVENT_STARTED (even if same capacity), DB unchanged
    await expect(
      updateEvent(createDbClient(adminClient), fixtureOrgId, eventId, { capacity: 10 }),
    ).rejects.toMatchObject({ code: "EVENT_STARTED" });
    expect(await getDbSnapshot(eventId)).toEqual(snap1);

    // 5. Update only title -> SUCCEEDS after started
    await updateEvent(createDbClient(adminClient), fixtureOrgId, eventId, {
      title: "Updated Title After Started",
    });
    const updatedTitleRes = await adminClient.query<{ title: string }>(
      `SELECT title FROM events WHERE id = $1`,
      [eventId],
    );
    expect(updatedTitleRes.rows[0].title).toBe("Updated Title After Started");
  });

  // --- C6 Part 3: Event cancelled & precedence ---
  it("C6: cancelled event rejects register/cancel;既取消又开始 precedence returns EVENT_CANCELLED", async () => {
    const eventId = crypto.randomUUID();
    await adminClient.query(
      `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW() + interval '5 days', NOW() + interval '2 days', 5, 'cancelled', $5, NOW(), NOW())`,
      [eventId, fixtureOrgId, "C6 Cancelled Event", "Test", fixtureOwnerId],
    );

    const user1 = await createUser("Cancelled User 1");
    // Insert an active registration fixture
    const regId = crypto.randomUUID();
    await adminClient.query(
      `INSERT INTO registrations (id, event_id, organization_id, user_id, status, created_at)
       VALUES ($1, $2, $3, $4, 'confirmed', NOW())`,
      [regId, eventId, fixtureOrgId, user1],
    );
    const user2 = await createUser("Cancelled User 2");

    // 1. Register -> EVENT_CANCELLED
    const snap1 = await getDbSnapshot(eventId);
    await expect(
      register(createDbClient(adminClient), fixtureOrgId, eventId, user2),
    ).rejects.toMatchObject({ code: "EVENT_CANCELLED" });
    expect(await getDbSnapshot(eventId)).toEqual(snap1);

    // 2. Duplicate register -> EVENT_CANCELLED
    await expect(
      register(createDbClient(adminClient), fixtureOrgId, eventId, user1),
    ).rejects.toMatchObject({ code: "EVENT_CANCELLED" });
    expect(await getDbSnapshot(eventId)).toEqual(snap1);

    // 3. Cancel registration -> EVENT_CANCELLED
    await expect(
      cancel(createDbClient(adminClient), fixtureOrgId, eventId, { me: true }, { userId: user1 }),
    ).rejects.toMatchObject({ code: "EVENT_CANCELLED" });
    expect(await getDbSnapshot(eventId)).toEqual(snap1);

    // 4. Precedence: Event is BOTH cancelled and started -> must return EVENT_CANCELLED (not EVENT_STARTED)
    const bothEventId = crypto.randomUUID();
    await adminClient.query(
      `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW() - interval '1 hour', NOW() - interval '2 hours', 5, 'cancelled', $5, NOW(), NOW())`,
      [bothEventId, fixtureOrgId, "C6 Both Cancelled and Started", "Test", fixtureOwnerId],
    );

    await expect(
      register(createDbClient(adminClient), fixtureOrgId, bothEventId, user2),
    ).rejects.toMatchObject({ code: "EVENT_CANCELLED" });

    await expect(
      cancel(
        createDbClient(adminClient),
        fixtureOrgId,
        bothEventId,
        { me: true },
        { userId: user1 },
      ),
    ).rejects.toMatchObject({ code: "EVENT_CANCELLED" });

    await expect(
      updateEvent(createDbClient(adminClient), fixtureOrgId, bothEventId, { capacity: 10 }),
    ).rejects.toMatchObject({ code: "EVENT_CANCELLED" });
  });

  // --- C6 Part 4: cancelEvent semantics ---
  it("C6: cancelEvent transitions open to cancelled, preserves registrations; duplicate is EVENT_CANCELLED; started is EVENT_STARTED", async () => {
    const eventId = crypto.randomUUID();
    await adminClient.query(
      `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW() + interval '5 days', NOW() + interval '2 days', 5, 'open', $5, NOW(), NOW())`,
      [eventId, fixtureOrgId, "C6 Event to Cancel", "Test", fixtureOwnerId],
    );

    const user1 = await createUser("CancelEvent User 1");
    await register(createDbClient(adminClient), fixtureOrgId, eventId, user1);

    const regsBefore = await adminClient.query(
      `SELECT * FROM registrations WHERE event_id = $1 ORDER BY id`,
      [eventId],
    );

    // 1. Successful cancelEvent: status = cancelled, registrations unchanged
    await cancelEvent(createDbClient(adminClient), fixtureOrgId, eventId);

    const eventAfter = await adminClient.query<{ status: string }>(
      `SELECT status FROM events WHERE id = $1`,
      [eventId],
    );
    expect(eventAfter.rows[0].status).toBe("cancelled");

    const regsAfter = await adminClient.query(
      `SELECT * FROM registrations WHERE event_id = $1 ORDER BY id`,
      [eventId],
    );
    expect(regsAfter.rows).toEqual(regsBefore.rows);

    // 2. Duplicate cancelEvent -> EVENT_CANCELLED
    await expect(
      cancelEvent(createDbClient(adminClient), fixtureOrgId, eventId),
    ).rejects.toMatchObject({ code: "EVENT_CANCELLED" });

    // 3. cancelEvent on started event -> EVENT_STARTED
    const startedEventId = crypto.randomUUID();
    await adminClient.query(
      `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW() - interval '1 hour', NOW() - interval '2 hours', 5, 'open', $5, NOW(), NOW())`,
      [startedEventId, fixtureOrgId, "C6 Started Event for CancelEvent", "Test", fixtureOwnerId],
    );

    await expect(
      cancelEvent(createDbClient(adminClient), fixtureOrgId, startedEventId),
    ).rejects.toMatchObject({ code: "EVENT_STARTED" });
  });

  // --- C6 Part 5: Deterministic lock interleaving (clock_timestamp vs now) ---
  it("C6: deterministic lock interleaving: B waits on event row lock, A updates deadline with clock_timestamp(), B receives REGISTRATION_CLOSED", async () => {
    const eventId = crypto.randomUUID();
    // Event deadline in future (+5 days)
    await adminClient.query(
      `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW() + interval '10 days', NOW() + interval '5 days', 10, 'open', $5, NOW(), NOW())`,
      [eventId, fixtureOrgId, "C6 Interleaving Event", "Test", fixtureOwnerId],
    );

    const userB = await createUser("Interleaving User B");

    const clientA = new pg.Client({
      connectionString: ctx.testDbUrl,
      application_name: "c6-interleave-A",
    });
    const clientB = new pg.Client({
      connectionString: ctx.testDbUrl,
      application_name: "c6-interleave-B",
    });
    const clientObserver = new pg.Client({
      connectionString: ctx.testDbUrl,
      application_name: "c6-interleave-observer",
    });

    await clientA.connect();
    await clientB.connect();
    await clientObserver.connect();

    const dbB = createDbClient(clientB);

    try {
      const aPidRes = await clientA.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const aPid = aPidRes.rows[0].pid;

      // 1. A starts transaction and locks event row with FOR NO KEY UPDATE while event not closed
      await clientA.query("BEGIN");
      await clientA.query(
        "SELECT id FROM events WHERE id = $1 AND organization_id = $2 FOR NO KEY UPDATE",
        [eventId, fixtureOrgId],
      );

      await clientB.query("SET lock_timeout = '30s'");

      // 2. B starts registration and blocks on the event row lock
      let bFinished = false;
      let bError: unknown = null;
      let bResult: unknown = null;

      const bPromise = register(dbB, fixtureOrgId, eventId, userB)
        .then((res) => {
          bFinished = true;
          bResult = res;
        })
        .catch((err) => {
          bFinished = true;
          bError = err;
        });

      // 3. Observer polls until B is observed in Lock wait
      await waitForLockWait(clientObserver, "c6-interleave-B", aPid, 10000);
      expect(bFinished).toBe(false);

      // 4. A updates registration_deadline using clock_timestamp() and commits
      await clientA.query(
        "UPDATE events SET registration_deadline = clock_timestamp() WHERE id = $1",
        [eventId],
      );
      await clientA.query("COMMIT");

      // 5. B acquires lock, reads db clock, and MUST be rejected with REGISTRATION_CLOSED
      await bPromise;
      expect(bFinished).toBe(true);
      expect(bError).toBeDefined();
      expect((bError as { code?: string })?.code).toBe("REGISTRATION_CLOSED");
      expect(bResult).toBeNull();

      // Ensure no registration row exists for B
      const bRegCount = await clientObserver.query<{ c: number }>(
        "SELECT count(*)::int AS c FROM registrations WHERE event_id = $1 AND user_id = $2",
        [eventId, userB],
      );
      expect(bRegCount.rows[0].c).toBe(0);
    } finally {
      await clientA.query("ROLLBACK").catch(() => {});
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
      await clientObserver.end().catch(() => {});
    }
  });

  // =========================================================================
  // F-T1: Lock Mutex Extension (cancel, updateEvent with capacity, cancelEvent)
  // =========================================================================

  it("F-T1 cancel: Connection A holds FOR NO KEY UPDATE, B calls cancel, observing Lock wait and release -> cancelled", async () => {
    const eventId = crypto.randomUUID();
    await adminClient.query(
      `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW() + interval '5 days', NOW() + interval '2 days', 5, 'open', $5, NOW(), NOW())`,
      [eventId, fixtureOrgId, "F-T1 Cancel Event", "Desc", fixtureOwnerId],
    );

    const userB = await createUser("FT1 Cancel User");
    const regId = crypto.randomUUID();
    await adminClient.query(
      `INSERT INTO registrations (id, organization_id, event_id, user_id, status, created_at)
       VALUES ($1, $2, $3, $4, 'confirmed', NOW())`,
      [regId, fixtureOrgId, eventId, userB],
    );

    const clientA = new pg.Client({
      connectionString: ctx.testDbUrl,
      application_name: "ft1-cancel-A",
    });
    const clientB = new pg.Client({
      connectionString: ctx.testDbUrl,
      application_name: "ft1-cancel-B",
    });
    const clientObserver = new pg.Client({
      connectionString: ctx.testDbUrl,
      application_name: "ft1-cancel-obs",
    });

    await clientA.connect();
    await clientB.connect();
    await clientObserver.connect();

    const dbB = createDbClient(clientB);

    try {
      const aPidRes = await clientA.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const bPidRes = await clientB.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const aPid = aPidRes.rows[0].pid;
      const bPid = bPidRes.rows[0].pid;
      assertDistinctPids([aPid, bPid]);

      // 1. A starts transaction and locks event row with FOR NO KEY UPDATE
      await clientA.query("BEGIN");
      await clientA.query(
        "SELECT id FROM events WHERE id = $1 AND organization_id = $2 FOR NO KEY UPDATE",
        [eventId, fixtureOrgId],
      );

      // Set lock_timeout on B only to prevent hanging
      await clientB.query("SET lock_timeout = '10s'");

      // 2. B calls cancel on independent connection
      let bFinished = false;
      let bResult: unknown = null;
      let bError: unknown = null;

      const bPromise = cancel(dbB, fixtureOrgId, eventId, { me: true }, { userId: userB })
        .then((res) => {
          bFinished = true;
          bResult = res;
        })
        .catch((err) => {
          bFinished = true;
          bError = err;
        });

      // 3. Observer polls until B enters Lock wait blocked by A
      await waitForLockWait(clientObserver, "ft1-cancel-B", aPid, 10000);

      // 4. Assert B is not finished and DB has no changes
      expect(bFinished).toBe(false);
      const preCommitReg = await clientObserver.query<{
        status: string;
        cancelled_at: Date | null;
      }>("SELECT status, cancelled_at FROM registrations WHERE id = $1", [regId]);
      expect(preCommitReg.rows[0].status).toBe("confirmed");
      expect(preCommitReg.rows[0].cancelled_at).toBeNull();

      // 5. A commits
      await clientA.query("COMMIT");

      // 6. B finishes and DB state is cancelled
      await bPromise;
      if (bError) throw bError;
      expect(bFinished).toBe(true);
      expect(bResult).toEqual({ kind: "cancelled" });

      const postCommitReg = await clientObserver.query<{
        status: string;
        cancelled_at: Date | null;
      }>("SELECT status, cancelled_at FROM registrations WHERE id = $1", [regId]);
      expect(postCommitReg.rows[0].status).toBe("cancelled");
      expect(postCommitReg.rows[0].cancelled_at).not.toBeNull();
    } finally {
      await clientA.query("ROLLBACK").catch(() => {});
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
      await clientObserver.end().catch(() => {});
    }
  });

  it("F-T1 updateEvent: Connection A holds FOR NO KEY UPDATE, B calls updateEvent with capacity, observing Lock wait and release -> capacity updated", async () => {
    const eventId = crypto.randomUUID();
    await adminClient.query(
      `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW() + interval '5 days', NOW() + interval '2 days', 5, 'open', $5, NOW(), NOW())`,
      [eventId, fixtureOrgId, "F-T1 Update Event", "Desc", fixtureOwnerId],
    );

    const clientA = new pg.Client({
      connectionString: ctx.testDbUrl,
      application_name: "ft1-update-A",
    });
    const clientB = new pg.Client({
      connectionString: ctx.testDbUrl,
      application_name: "ft1-update-B",
    });
    const clientObserver = new pg.Client({
      connectionString: ctx.testDbUrl,
      application_name: "ft1-update-obs",
    });

    await clientA.connect();
    await clientB.connect();
    await clientObserver.connect();

    const dbB = createDbClient(clientB);

    try {
      const aPidRes = await clientA.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const bPidRes = await clientB.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const aPid = aPidRes.rows[0].pid;
      const bPid = bPidRes.rows[0].pid;
      assertDistinctPids([aPid, bPid]);

      // 1. A starts transaction and locks event row with FOR NO KEY UPDATE
      await clientA.query("BEGIN");
      await clientA.query(
        "SELECT id FROM events WHERE id = $1 AND organization_id = $2 FOR NO KEY UPDATE",
        [eventId, fixtureOrgId],
      );

      // Set lock_timeout on B only to prevent hanging
      await clientB.query("SET lock_timeout = '10s'");

      // 2. B calls updateEvent with capacity on independent connection
      let bFinished = false;
      let bResult: unknown = null;
      let bError: unknown = null;

      const bPromise = updateEvent(dbB, fixtureOrgId, eventId, { capacity: 20 })
        .then((res) => {
          bFinished = true;
          bResult = res;
        })
        .catch((err) => {
          bFinished = true;
          bError = err;
        });

      // 3. Observer polls until B enters Lock wait blocked by A
      await waitForLockWait(clientObserver, "ft1-update-B", aPid, 10000);

      // 4. Assert B is not finished and DB has no changes
      expect(bFinished).toBe(false);
      const preCommitEvent = await clientObserver.query<{ capacity: number }>(
        "SELECT capacity FROM events WHERE id = $1",
        [eventId],
      );
      expect(preCommitEvent.rows[0].capacity).toBe(5);

      // 5. A commits
      await clientA.query("COMMIT");

      // 6. B finishes and DB capacity is updated
      await bPromise;
      if (bError) throw bError;
      expect(bFinished).toBe(true);
      expect(bResult).toMatchObject({ capacity: 20 });

      const postCommitEvent = await clientObserver.query<{ capacity: number }>(
        "SELECT capacity FROM events WHERE id = $1",
        [eventId],
      );
      expect(postCommitEvent.rows[0].capacity).toBe(20);
    } finally {
      await clientA.query("ROLLBACK").catch(() => {});
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
      await clientObserver.end().catch(() => {});
    }
  });

  it("F-T1 cancelEvent: Connection A holds FOR NO KEY UPDATE, B calls cancelEvent, observing Lock wait and release -> status cancelled", async () => {
    const eventId = crypto.randomUUID();
    await adminClient.query(
      `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW() + interval '5 days', NOW() + interval '2 days', 5, 'open', $5, NOW(), NOW())`,
      [eventId, fixtureOrgId, "F-T1 CancelEvent Event", "Desc", fixtureOwnerId],
    );

    const clientA = new pg.Client({
      connectionString: ctx.testDbUrl,
      application_name: "ft1-cancelevent-A",
    });
    const clientB = new pg.Client({
      connectionString: ctx.testDbUrl,
      application_name: "ft1-cancelevent-B",
    });
    const clientObserver = new pg.Client({
      connectionString: ctx.testDbUrl,
      application_name: "ft1-cancelevent-obs",
    });

    await clientA.connect();
    await clientB.connect();
    await clientObserver.connect();

    const dbB = createDbClient(clientB);

    try {
      const aPidRes = await clientA.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const bPidRes = await clientB.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const aPid = aPidRes.rows[0].pid;
      const bPid = bPidRes.rows[0].pid;
      assertDistinctPids([aPid, bPid]);

      // 1. A starts transaction and locks event row with FOR NO KEY UPDATE
      await clientA.query("BEGIN");
      await clientA.query(
        "SELECT id FROM events WHERE id = $1 AND organization_id = $2 FOR NO KEY UPDATE",
        [eventId, fixtureOrgId],
      );

      // Set lock_timeout on B only to prevent hanging
      await clientB.query("SET lock_timeout = '10s'");

      // 2. B calls cancelEvent on independent connection
      let bFinished = false;
      let bResult: unknown = null;
      let bError: unknown = null;

      const bPromise = cancelEvent(dbB, fixtureOrgId, eventId)
        .then((res) => {
          bFinished = true;
          bResult = res;
        })
        .catch((err) => {
          bFinished = true;
          bError = err;
        });

      // 3. Observer polls until B enters Lock wait blocked by A
      await waitForLockWait(clientObserver, "ft1-cancelevent-B", aPid, 10000);

      // 4. Assert B is not finished and DB has no changes
      expect(bFinished).toBe(false);
      const preCommitEvent = await clientObserver.query<{ status: string }>(
        "SELECT status FROM events WHERE id = $1",
        [eventId],
      );
      expect(preCommitEvent.rows[0].status).toBe("open");

      // 5. A commits
      await clientA.query("COMMIT");

      // 6. B finishes and DB status is cancelled
      await bPromise;
      if (bError) throw bError;
      expect(bFinished).toBe(true);
      expect(bResult).toMatchObject({ status: "cancelled" });

      const postCommitEvent = await clientObserver.query<{ status: string }>(
        "SELECT status FROM events WHERE id = $1",
        [eventId],
      );
      expect(postCommitEvent.rows[0].status).toBe("cancelled");
    } finally {
      await clientA.query("ROLLBACK").catch(() => {});
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
      await clientObserver.end().catch(() => {});
    }
  });

  // =========================================================================
  // F-T2: Clock Interleaving Extension (cancel, updateEvent with capacity, cancelEvent)
  // =========================================================================

  it("F-T2 cancel: Connection A holds lock, B calls cancel and blocks, A updates starts_at to clock_timestamp() -> B rejected with EVENT_STARTED and DB unchanged", async () => {
    const eventId = crypto.randomUUID();
    // Fixture: starts_at in future (1 hour), registration_deadline in past (10 minutes)
    await adminClient.query(
      `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW() + interval '1 hour', NOW() - interval '10 minutes', 5, 'open', $5, NOW(), NOW())`,
      [eventId, fixtureOrgId, "F-T2 Cancel Event", "Desc", fixtureOwnerId],
    );

    const userB = await createUser("FT2 Cancel User");
    const regId = crypto.randomUUID();
    await adminClient.query(
      `INSERT INTO registrations (id, organization_id, event_id, user_id, status, created_at)
       VALUES ($1, $2, $3, $4, 'confirmed', NOW())`,
      [regId, fixtureOrgId, eventId, userB],
    );

    const snapBefore = await getDbSnapshot(eventId);
    const allRegsBefore = await adminClient.query(`SELECT * FROM registrations ORDER BY id`);

    const clientA = new pg.Client({
      connectionString: ctx.testDbUrl,
      application_name: "ft2-cancel-A",
    });
    const clientB = new pg.Client({
      connectionString: ctx.testDbUrl,
      application_name: "ft2-cancel-B",
    });
    const clientObserver = new pg.Client({
      connectionString: ctx.testDbUrl,
      application_name: "ft2-cancel-obs",
    });

    await clientA.connect();
    await clientB.connect();
    await clientObserver.connect();

    const dbB = createDbClient(clientB);

    try {
      const aPidRes = await clientA.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const bPidRes = await clientB.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const aPid = aPidRes.rows[0].pid;
      const bPid = bPidRes.rows[0].pid;
      assertDistinctPids([aPid, bPid]);

      // 1. A starts transaction and locks event row with FOR NO KEY UPDATE
      await clientA.query("BEGIN");
      await clientA.query(
        "SELECT id FROM events WHERE id = $1 AND organization_id = $2 FOR NO KEY UPDATE",
        [eventId, fixtureOrgId],
      );

      await clientB.query("SET lock_timeout = '10s'");

      // 2. B calls cancel and blocks
      let bFinished = false;
      let bError: unknown = null;
      let bResult: unknown = null;

      const bPromise = cancel(dbB, fixtureOrgId, eventId, { me: true }, { userId: userB })
        .then((res) => {
          bFinished = true;
          bResult = res;
        })
        .catch((err) => {
          bFinished = true;
          bError = err;
        });

      // 3. Observer polls until B enters Lock wait
      await waitForLockWait(clientObserver, "ft2-cancel-B", aPid, 10000);
      expect(bFinished).toBe(false);

      // 4. A updates starts_at using clock_timestamp() and commits
      await clientA.query("UPDATE events SET starts_at = clock_timestamp() WHERE id = $1", [
        eventId,
      ]);
      await clientA.query("COMMIT");

      // 5. B acquires lock and must throw EVENT_STARTED
      await bPromise;
      expect(bFinished).toBe(true);
      expect(bError).toBeDefined();
      expect((bError as { code?: string })?.code).toBe("EVENT_STARTED");
      expect(bResult).toBeNull();

      // 6. Snapshot comparison: registrations whole table unchanged, events unchanged except starts_at
      const allRegsAfter = await adminClient.query(`SELECT * FROM registrations ORDER BY id`);
      expect(allRegsAfter.rows).toEqual(allRegsBefore.rows);

      const snapAfter = await getDbSnapshot(eventId);
      expect(snapAfter.regs).toEqual(snapBefore.regs);
      const { starts_at: startsAtBefore, ...eventRestBefore } = snapBefore.event;
      const { starts_at: startsAtAfter, ...eventRestAfter } = snapAfter.event;
      expect(eventRestAfter).toEqual(eventRestBefore);
      expect(new Date(startsAtAfter).getTime()).not.toBe(new Date(startsAtBefore).getTime());
    } finally {
      await clientA.query("ROLLBACK").catch(() => {});
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
      await clientObserver.end().catch(() => {});
    }
  });

  it("F-T2 updateEvent: Connection A holds lock, B calls updateEvent with capacity and blocks, A updates starts_at to clock_timestamp() -> B rejected with EVENT_STARTED and DB unchanged", async () => {
    const eventId = crypto.randomUUID();
    // Fixture: starts_at in future (1 hour), registration_deadline in past (10 minutes)
    await adminClient.query(
      `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW() + interval '1 hour', NOW() - interval '10 minutes', 5, 'open', $5, NOW(), NOW())`,
      [eventId, fixtureOrgId, "F-T2 Update Event", "Desc", fixtureOwnerId],
    );

    const snapBefore = await getDbSnapshot(eventId);
    const allRegsBefore = await adminClient.query(`SELECT * FROM registrations ORDER BY id`);

    const clientA = new pg.Client({
      connectionString: ctx.testDbUrl,
      application_name: "ft2-update-A",
    });
    const clientB = new pg.Client({
      connectionString: ctx.testDbUrl,
      application_name: "ft2-update-B",
    });
    const clientObserver = new pg.Client({
      connectionString: ctx.testDbUrl,
      application_name: "ft2-update-obs",
    });

    await clientA.connect();
    await clientB.connect();
    await clientObserver.connect();

    const dbB = createDbClient(clientB);

    try {
      const aPidRes = await clientA.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const bPidRes = await clientB.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const aPid = aPidRes.rows[0].pid;
      const bPid = bPidRes.rows[0].pid;
      assertDistinctPids([aPid, bPid]);

      // 1. A starts transaction and locks event row with FOR NO KEY UPDATE
      await clientA.query("BEGIN");
      await clientA.query(
        "SELECT id FROM events WHERE id = $1 AND organization_id = $2 FOR NO KEY UPDATE",
        [eventId, fixtureOrgId],
      );

      await clientB.query("SET lock_timeout = '10s'");

      // 2. B calls updateEvent with capacity and blocks
      let bFinished = false;
      let bError: unknown = null;
      let bResult: unknown = null;

      const bPromise = updateEvent(dbB, fixtureOrgId, eventId, { capacity: 20 })
        .then((res) => {
          bFinished = true;
          bResult = res;
        })
        .catch((err) => {
          bFinished = true;
          bError = err;
        });

      // 3. Observer polls until B enters Lock wait
      await waitForLockWait(clientObserver, "ft2-update-B", aPid, 10000);
      expect(bFinished).toBe(false);

      // 4. A updates starts_at using clock_timestamp() and commits
      await clientA.query("UPDATE events SET starts_at = clock_timestamp() WHERE id = $1", [
        eventId,
      ]);
      await clientA.query("COMMIT");

      // 5. B acquires lock and must throw EVENT_STARTED
      await bPromise;
      expect(bFinished).toBe(true);
      expect(bError).toBeDefined();
      expect((bError as { code?: string })?.code).toBe("EVENT_STARTED");
      expect(bResult).toBeNull();

      // 6. Snapshot comparison: registrations whole table unchanged, events unchanged except starts_at
      const allRegsAfter = await adminClient.query(`SELECT * FROM registrations ORDER BY id`);
      expect(allRegsAfter.rows).toEqual(allRegsBefore.rows);

      const snapAfter = await getDbSnapshot(eventId);
      expect(snapAfter.regs).toEqual(snapBefore.regs);
      const { starts_at: startsAtBefore, ...eventRestBefore } = snapBefore.event;
      const { starts_at: startsAtAfter, ...eventRestAfter } = snapAfter.event;
      expect(eventRestAfter).toEqual(eventRestBefore);
      expect(new Date(startsAtAfter).getTime()).not.toBe(new Date(startsAtBefore).getTime());
    } finally {
      await clientA.query("ROLLBACK").catch(() => {});
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
      await clientObserver.end().catch(() => {});
    }
  });

  it("F-T2 cancelEvent: Connection A holds lock, B calls cancelEvent and blocks, A updates starts_at to clock_timestamp() -> B rejected with EVENT_STARTED and DB unchanged", async () => {
    const eventId = crypto.randomUUID();
    // Fixture: starts_at in future (1 hour), registration_deadline in past (10 minutes)
    await adminClient.query(
      `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW() + interval '1 hour', NOW() - interval '10 minutes', 5, 'open', $5, NOW(), NOW())`,
      [eventId, fixtureOrgId, "F-T2 CancelEvent Event", "Desc", fixtureOwnerId],
    );

    const snapBefore = await getDbSnapshot(eventId);
    const allRegsBefore = await adminClient.query(`SELECT * FROM registrations ORDER BY id`);

    const clientA = new pg.Client({
      connectionString: ctx.testDbUrl,
      application_name: "ft2-cancelevent-A",
    });
    const clientB = new pg.Client({
      connectionString: ctx.testDbUrl,
      application_name: "ft2-cancelevent-B",
    });
    const clientObserver = new pg.Client({
      connectionString: ctx.testDbUrl,
      application_name: "ft2-cancelevent-obs",
    });

    await clientA.connect();
    await clientB.connect();
    await clientObserver.connect();

    const dbB = createDbClient(clientB);

    try {
      const aPidRes = await clientA.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const bPidRes = await clientB.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const aPid = aPidRes.rows[0].pid;
      const bPid = bPidRes.rows[0].pid;
      assertDistinctPids([aPid, bPid]);

      // 1. A starts transaction and locks event row with FOR NO KEY UPDATE
      await clientA.query("BEGIN");
      await clientA.query(
        "SELECT id FROM events WHERE id = $1 AND organization_id = $2 FOR NO KEY UPDATE",
        [eventId, fixtureOrgId],
      );

      await clientB.query("SET lock_timeout = '10s'");

      // 2. B calls cancelEvent and blocks
      let bFinished = false;
      let bError: unknown = null;
      let bResult: unknown = null;

      const bPromise = cancelEvent(dbB, fixtureOrgId, eventId)
        .then((res) => {
          bFinished = true;
          bResult = res;
        })
        .catch((err) => {
          bFinished = true;
          bError = err;
        });

      // 3. Observer polls until B enters Lock wait
      await waitForLockWait(clientObserver, "ft2-cancelevent-B", aPid, 10000);
      expect(bFinished).toBe(false);

      // 4. A updates starts_at using clock_timestamp() and commits
      await clientA.query("UPDATE events SET starts_at = clock_timestamp() WHERE id = $1", [
        eventId,
      ]);
      await clientA.query("COMMIT");

      // 5. B acquires lock and must throw EVENT_STARTED
      await bPromise;
      expect(bFinished).toBe(true);
      expect(bError).toBeDefined();
      expect((bError as { code?: string })?.code).toBe("EVENT_STARTED");
      expect(bResult).toBeNull();

      // 6. Snapshot comparison: registrations whole table unchanged, events unchanged except starts_at
      const allRegsAfter = await adminClient.query(`SELECT * FROM registrations ORDER BY id`);
      expect(allRegsAfter.rows).toEqual(allRegsBefore.rows);

      const snapAfter = await getDbSnapshot(eventId);
      expect(snapAfter.regs).toEqual(snapBefore.regs);
      const { starts_at: startsAtBefore, ...eventRestBefore } = snapBefore.event;
      const { starts_at: startsAtAfter, ...eventRestAfter } = snapAfter.event;
      expect(eventRestAfter).toEqual(eventRestBefore);
      expect(new Date(startsAtAfter).getTime()).not.toBe(new Date(startsAtBefore).getTime());
    } finally {
      await clientA.query("ROLLBACK").catch(() => {});
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
      await clientObserver.end().catch(() => {});
    }
  });
});
