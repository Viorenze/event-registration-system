import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { createDbClient, type Db, pg } from "@event-system/db";
import { setupTestDatabase, type TestDatabaseContext } from "./test-helper.ts";
import { cancel, register, updateEvent } from "./registrations.ts";
import { assertInvariants, createStartGate } from "./test-helpers/concurrency-harness.ts";

describe("C3, C8, C5, C4: Cancellation, Promotion & Capacity Concurrency Tests", () => {
  let ctx: TestDatabaseContext;
  let adminClient: pg.PoolClient;
  let fixtureOrgId: string;
  let fixtureOwnerId: string;
  let fixtureAdminId: string;

  beforeAll(async () => {
    ctx = await setupTestDatabase();
    process.env.DATABASE_URL = ctx.testDbUrl;
    adminClient = await ctx.pool.connect();

    fixtureOrgId = `c_org_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    await adminClient.query(
      `INSERT INTO organization (id, name, slug, created_at) VALUES ($1, $2, $3, NOW())`,
      [fixtureOrgId, "Cancel-Promote Org", `cp-org-${crypto.randomUUID().slice(0, 8)}`],
    );

    fixtureOwnerId = `cp_owner_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    await adminClient.query(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, true, NOW(), NOW())`,
      [fixtureOwnerId, "CP Owner", `cp_owner_${crypto.randomUUID().slice(0, 8)}@example.com`],
    );
    await adminClient.query(
      `INSERT INTO "member" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, 'owner', NOW())`,
      [`mem_${fixtureOwnerId}`, fixtureOrgId, fixtureOwnerId],
    );

    fixtureAdminId = `cp_admin_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    await adminClient.query(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, true, NOW(), NOW())`,
      [fixtureAdminId, "CP Admin", `cp_admin_${crypto.randomUUID().slice(0, 8)}@example.com`],
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

  // Helper to create users & members
  async function createUsers(count: number, prefix: string): Promise<string[]> {
    const userIds: string[] = [];
    for (let i = 0; i < count; i++) {
      const uId = `${prefix}_user_${Date.now()}_${i}_${crypto.randomUUID().slice(0, 6)}`;
      userIds.push(uId);
      await adminClient.query(
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, true, NOW(), NOW())`,
        [uId, `${prefix} User ${i}`, `${uId}@example.com`],
      );
      await adminClient.query(
        `INSERT INTO "member" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, 'member', NOW())`,
        [`mem_${uId}`, fixtureOrgId, uId],
      );
    }
    return userIds;
  }

  // --- C3: Capacity 10 with 5 waitlisted, cancel 1 confirmed -> min seq waitlisted promoted ---
  it("C3: cancelling 1 confirmed promotes waitlisted with smallest seq; promoted_at equals cancelled_at", async () => {
    const eventId = crypto.randomUUID();
    await adminClient.query(
      `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW() + interval '10 days', NOW() + interval '5 days', 10, 'open', $5, NOW(), NOW())`,
      [eventId, fixtureOrgId, "C3 Event", "Event for C3", fixtureOwnerId],
    );

    const userIds = await createUsers(15, "c3");
    // Register 15 users sequentially: first 10 confirmed, next 5 waitlisted
    for (const uId of userIds) {
      await register(createDbClient(adminClient), fixtureOrgId, eventId, uId);
    }

    const regRowsBefore = await adminClient.query<{
      id: string;
      user_id: string;
      status: string;
      seq: number;
    }>(`SELECT id, user_id, status, seq FROM registrations WHERE event_id = $1 ORDER BY seq ASC`, [
      eventId,
    ]);
    const confirmedBefore = regRowsBefore.rows.filter((r) => r.status === "confirmed");
    const waitlistedBefore = regRowsBefore.rows.filter((r) => r.status === "waitlisted");
    expect(confirmedBefore.length).toBe(10);
    expect(waitlistedBefore.length).toBe(5);

    const targetToCancel = confirmedBefore[0];
    const candidateToPromote = waitlistedBefore[0]; // min seq in waitlisted

    // Cancel target
    const cancelRes = await cancel(
      createDbClient(adminClient),
      fixtureOrgId,
      eventId,
      { me: true },
      { userId: targetToCancel.user_id, role: "member" },
    );
    expect(cancelRes).toEqual({ kind: "cancelled" });

    // Verify DB state
    const regRowsAfter = await adminClient.query<{
      id: string;
      user_id: string;
      status: string;
      seq: number;
      cancelled_at: Date | null;
      promoted_at: Date | null;
    }>(
      `SELECT id, user_id, status, seq, cancelled_at, promoted_at FROM registrations WHERE event_id = $1 ORDER BY seq ASC`,
      [eventId],
    );

    const cancelledRow = regRowsAfter.rows.find((r) => r.id === targetToCancel.id);
    expect(cancelledRow?.status).toBe("cancelled");
    expect(cancelledRow?.cancelled_at).not.toBeNull();

    const promotedRow = regRowsAfter.rows.find((r) => r.id === candidateToPromote.id);
    expect(promotedRow?.status).toBe("confirmed");
    expect(promotedRow?.promoted_at).not.toBeNull();

    // Promoted_at and cancelled_at must be the exact same DB timestamp
    expect(promotedRow?.promoted_at?.getTime()).toBe(cancelledRow?.cancelled_at?.getTime());

    // Invariants
    await assertInvariants(adminClient, eventId);
  });

  // --- C8: Idempotency and Targeting for Cancellations ---
  it("C8: cancellation idempotency, targeting, and non-noop on started/cancelled events", async () => {
    const eventId = crypto.randomUUID();
    await adminClient.query(
      `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW() + interval '10 days', NOW() + interval '5 days', 10, 'open', $5, NOW(), NOW())`,
      [eventId, fixtureOrgId, "C8 Event", "Event for C8", fixtureOwnerId],
    );

    const [user1, user2] = await createUsers(2, "c8");

    // 1. User without registration cancels -> noop, DB unchanged
    const preNoopSnapshot = await adminClient.query(
      `SELECT * FROM registrations WHERE event_id = $1 ORDER BY id`,
      [eventId],
    );
    const noopRes = await cancel(
      createDbClient(adminClient),
      fixtureOrgId,
      eventId,
      { me: true },
      { userId: user1, role: "member" },
    );
    expect(noopRes).toEqual({ kind: "noop" });
    const postNoopSnapshot = await adminClient.query(
      `SELECT * FROM registrations WHERE event_id = $1 ORDER BY id`,
      [eventId],
    );
    expect(postNoopSnapshot.rows).toEqual(preNoopSnapshot.rows);

    // 2. User 1 registers and cancels
    await register(createDbClient(adminClient), fixtureOrgId, eventId, user1);
    const firstCancel = await cancel(
      createDbClient(adminClient),
      fixtureOrgId,
      eventId,
      { me: true },
      { userId: user1, role: "member" },
    );
    expect(firstCancel).toEqual({ kind: "cancelled" });

    // Snapshot after first cancel
    const snapAfterFirst = await adminClient.query(
      `SELECT id, user_id, status, seq, cancelled_at, promoted_at FROM registrations WHERE event_id = $1 ORDER BY id`,
      [eventId],
    );

    // Duplicate cancel -> noop, compare all columns before and after duplicate cancel
    const duplicateCancel = await cancel(
      createDbClient(adminClient),
      fixtureOrgId,
      eventId,
      { me: true },
      { userId: user1, role: "member" },
    );
    expect(duplicateCancel).toEqual({ kind: "noop" });

    const snapAfterDuplicate = await adminClient.query(
      `SELECT id, user_id, status, seq, cancelled_at, promoted_at FROM registrations WHERE event_id = $1 ORDER BY id`,
      [eventId],
    );
    expect(snapAfterDuplicate.rows).toEqual(snapAfterFirst.rows);

    // 3. Different event ID in same org -> NOT_FOUND, DB unchanged
    const otherEventId = crypto.randomUUID();
    await adminClient.query(
      `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW() + interval '10 days', NOW() + interval '5 days', 10, 'open', $5, NOW(), NOW())`,
      [otherEventId, fixtureOrgId, "C8 Other Event", "Other event", fixtureOwnerId],
    );

    await expect(
      cancel(
        createDbClient(adminClient),
        fixtureOrgId,
        otherEventId,
        { registrationId: snapAfterFirst.rows[0].id },
        { userId: fixtureAdminId, role: "admin" },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // 4. Already started event and no active registration -> EVENT_STARTED instead of noop
    const startedEventId = crypto.randomUUID();
    await adminClient.query(
      `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW() - interval '1 hour', NOW() - interval '2 hours', 10, 'open', $5, NOW(), NOW())`,
      [startedEventId, fixtureOrgId, "C8 Started Event", "Started", fixtureOwnerId],
    );
    await expect(
      cancel(
        createDbClient(adminClient),
        fixtureOrgId,
        startedEventId,
        { me: true },
        { userId: user2, role: "member" },
      ),
    ).rejects.toMatchObject({ code: "EVENT_STARTED" });

    // 5. Already cancelled event and no active registration -> EVENT_CANCELLED instead of noop
    const cancelledEventId = crypto.randomUUID();
    await adminClient.query(
      `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW() + interval '10 days', NOW() + interval '5 days', 10, 'cancelled', $5, NOW(), NOW())`,
      [cancelledEventId, fixtureOrgId, "C8 Cancelled Event", "Cancelled", fixtureOwnerId],
    );
    await expect(
      cancel(
        createDbClient(adminClient),
        fixtureOrgId,
        cancelledEventId,
        { me: true },
        { userId: user2, role: "member" },
      ),
    ).rejects.toMatchObject({ code: "EVENT_CANCELLED" });
  });

  // --- C5: Capacity adjustments and waitlist promotions ---
  it("C5: capacity update promotes waitlist in seq order, rejects capacity below confirmed", async () => {
    const eventId = crypto.randomUUID();
    await adminClient.query(
      `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW() + interval '10 days', NOW() + interval '5 days', 10, 'open', $5, NOW(), NOW())`,
      [eventId, fixtureOrgId, "C5 Event", "Event for C5", fixtureOwnerId],
    );

    const userIds = await createUsers(15, "c5");
    for (const uId of userIds) {
      await register(createDbClient(adminClient), fixtureOrgId, eventId, uId);
    }

    // 1. Lower than confirmed count -> CAPACITY_BELOW_CONFIRMED, DB unchanged
    const preRejectSnap = await adminClient.query(`SELECT capacity FROM events WHERE id = $1`, [
      eventId,
    ]);
    await expect(
      updateEvent(createDbClient(adminClient), fixtureOrgId, eventId, { capacity: 9 }),
    ).rejects.toMatchObject({ code: "CAPACITY_BELOW_CONFIRMED" });
    const postRejectSnap = await adminClient.query(`SELECT capacity FROM events WHERE id = $1`, [
      eventId,
    ]);
    expect(postRejectSnap.rows[0].capacity).toBe(preRejectSnap.rows[0].capacity);

    // 2. Capacity equal to confirmed count -> success, no change in waitlisted
    await updateEvent(createDbClient(adminClient), fixtureOrgId, eventId, { capacity: 10 });

    // 3. 10 -> 12: only 2 waitlisted with smallest seq are promoted
    await updateEvent(createDbClient(adminClient), fixtureOrgId, eventId, { capacity: 12 });
    const snap12 = await adminClient.query<{ status: string; seq: number }>(
      `SELECT status, seq FROM registrations WHERE event_id = $1 ORDER BY seq ASC`,
      [eventId],
    );
    const confirmed12 = snap12.rows.filter((r) => r.status === "confirmed");
    const waitlisted12 = snap12.rows.filter((r) => r.status === "waitlisted");
    expect(confirmed12.length).toBe(12);
    expect(waitlisted12.length).toBe(3);
    await assertInvariants(adminClient, eventId);

    // 4. 12 -> 15: remaining 3 waitlisted promoted
    await updateEvent(createDbClient(adminClient), fixtureOrgId, eventId, { capacity: 15 });
    const snap15 = await adminClient.query<{ status: string }>(
      `SELECT status FROM registrations WHERE event_id = $1 ORDER BY seq ASC`,
      [eventId],
    );
    expect(snap15.rows.filter((r) => r.status === "confirmed").length).toBe(15);
    expect(snap15.rows.filter((r) => r.status === "waitlisted").length).toBe(0);
    await assertInvariants(adminClient, eventId);
  });

  // --- C4: Capacity 10, 10 confirmed + 5 waitlisted; concurrent 3 cancels + 20 new registrations ---
  it("C4: concurrent 3 cancels and 20 new registrations; final state satisfies invariants", async () => {
    const eventId = crypto.randomUUID();
    await adminClient.query(
      `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW() + interval '10 days', NOW() + interval '5 days', 10, 'open', $5, NOW(), NOW())`,
      [eventId, fixtureOrgId, "C4 Event", "Event for C4", fixtureOwnerId],
    );

    // Initial 15 users (10 confirmed, 5 waitlisted)
    const initialUsers = await createUsers(15, "c4_init");
    for (const uId of initialUsers) {
      await register(createDbClient(adminClient), fixtureOrgId, eventId, uId);
    }

    // 20 new users who will register concurrently
    const newUsers = await createUsers(20, "c4_new");

    // 3 confirmed users who will cancel concurrently
    const initialConfirmedRows = await adminClient.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM registrations WHERE event_id = $1 AND status = 'confirmed' ORDER BY seq ASC LIMIT 3`,
      [eventId],
    );
    const cancelTargets = initialConfirmedRows.rows;

    // 23 workers in total: 3 cancels + 20 registrations
    const clients: pg.Client[] = [];
    const dbs: Db[] = [];
    for (let i = 0; i < 23; i++) {
      const client = new pg.Client({
        connectionString: ctx.testDbUrl,
        application_name: `c4-worker-${i}`,
      });
      await client.connect();
      clients.push(client);
      dbs.push(createDbClient(client));
    }

    try {
      const { barrier, startSignal } = createStartGate();

      // 3 cancel tasks
      const cancelTasks = cancelTargets.map((target, idx) => {
        return (async () => {
          await barrier;
          return cancel(
            dbs[idx],
            fixtureOrgId,
            eventId,
            { me: true },
            { userId: target.user_id, role: "member" },
          );
        })();
      });

      // 20 registration tasks
      const regTasks = newUsers.map((uId, idx) => {
        return (async () => {
          await barrier;
          return register(dbs[3 + idx], fixtureOrgId, eventId, uId);
        })();
      });

      const allTasks = [...cancelTasks, ...regTasks];

      // Fire start signal
      startSignal();
      const results = await Promise.allSettled(allTasks);

      for (const res of results) {
        if (res.status === "rejected") {
          throw res.reason;
        }
      }

      // Assert final database state:
      // Capacity = 10, Confirmed = 10, Cancelled = 3, Waitlisted = 22, Total = 35
      const inv = await assertInvariants(adminClient, eventId);
      expect(inv.confirmedCount).toBe(10);
      expect(inv.cancelledCount).toBe(3);
      expect(inv.waitlistedCount).toBe(22);
    } finally {
      await Promise.all(clients.map((c) => c.end().catch(() => {})));
    }
  });
});
