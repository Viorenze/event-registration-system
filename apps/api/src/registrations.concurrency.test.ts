import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { type Db, createDbClient, pg } from "@event-system/db";
import { setupTestDatabase, type TestDatabaseContext } from "./test-helper.ts";
import { register } from "./registrations.ts";

describe("Registrations Concurrency Infrastructure & Tests (C1, C2, C7)", () => {
  let ctx: TestDatabaseContext;
  let adminClient: pg.PoolClient;
  let fixtureOrgId: string;
  let fixtureOwnerId: string;

  beforeAll(async () => {
    ctx = await setupTestDatabase();
    process.env.DATABASE_URL = ctx.testDbUrl;
    adminClient = await ctx.pool.connect();

    fixtureOrgId = `c_org_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    await adminClient.query(
      `INSERT INTO organization (id, name, slug, created_at) VALUES ($1, $2, $3, NOW())`,
      [fixtureOrgId, "Concurrency Org", `c-org-${crypto.randomUUID().slice(0, 8)}`],
    );

    fixtureOwnerId = `c_owner_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    await adminClient.query(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, true, NOW(), NOW())`,
      [
        fixtureOwnerId,
        "Concurrency Owner",
        `c_owner_${crypto.randomUUID().slice(0, 8)}@example.com`,
      ],
    );

    await adminClient.query(
      `INSERT INTO "member" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, 'owner', NOW())`,
      [`mem_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`, fixtureOrgId, fixtureOwnerId],
    );
  });

  afterAll(async () => {
    if (adminClient) {
      try {
        await adminClient.query(`DELETE FROM registrations WHERE organization_id = $1`, [
          fixtureOrgId,
        ]);
      } catch {}
      try {
        await adminClient.query(`DELETE FROM events WHERE organization_id = $1`, [fixtureOrgId]);
        await adminClient.query(`DELETE FROM "member" WHERE organization_id = $1`, [fixtureOrgId]);
        await adminClient.query(`DELETE FROM "user" WHERE id = $1`, [fixtureOwnerId]);
        await adminClient.query(`DELETE FROM organization WHERE id = $1`, [fixtureOrgId]);
      } catch {}
      adminClient.release();
    }
    if (ctx) {
      await ctx.cleanup();
    }
  });

  // --- C1: 50 independent workers competing for 10 spots ---
  it("C1: 50 different users simultaneously register for event with 10 capacity", async () => {
    const eventId = crypto.randomUUID();
    await adminClient.query(
      `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW() + interval '10 days', NOW() + interval '5 days', 10, 'open', $5, NOW(), NOW())`,
      [eventId, fixtureOrgId, "C1 10-Spot Event", "Concurrency Event C1", fixtureOwnerId],
    );

    // 1. Create 50 distinct users and members via SQL fixtures
    const userIds: string[] = [];
    for (let i = 0; i < 50; i++) {
      const uId = `c1_user_${Date.now()}_${i}_${crypto.randomUUID().slice(0, 6)}`;
      userIds.push(uId);
      await adminClient.query(
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, true, NOW(), NOW())`,
        [uId, `C1 User ${i}`, `${uId}@example.com`],
      );
      await adminClient.query(
        `INSERT INTO "member" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, 'member', NOW())`,
        [`mem_${uId}`, fixtureOrgId, uId],
      );
    }

    // 2. Establish 50 independent pg.Clients, each with application_name = d3-worker-<n>
    const clients: pg.Client[] = [];
    const dbs: Db[] = [];
    const pids: number[] = [];

    try {
      for (let i = 0; i < 50; i++) {
        const client = new pg.Client({
          connectionString: ctx.testDbUrl,
          application_name: `d3-worker-${i}`,
        });
        await client.connect();
        clients.push(client);
        dbs.push(createDbClient(client));

        const pidRes = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        pids.push(pidRes.rows[0].pid);
      }

      // Assert 50 backend pids are strictly distinct
      const uniquePids = new Set(pids);
      expect(uniquePids.size, `Expected 50 distinct backend PIDs, got ${uniquePids.size}`).toBe(50);

      // 3. Coordinate simultaneously via barrier promise
      let startSignal!: () => void;
      const barrier = new Promise<void>((resolve) => {
        startSignal = resolve;
      });

      const promises = clients.map((_, i) => {
        return (async () => {
          await barrier;
          return register(dbs[i], fixtureOrgId, eventId, userIds[i]);
        })();
      });

      // Fire start signal
      startSignal();
      const settled = await Promise.allSettled(promises);

      // Verify no unexpected network/connection drops
      for (const res of settled) {
        if (res.status === "rejected") {
          throw res.reason;
        }
      }

      // 4. Assert database final state
      const regRows = await adminClient.query<{
        id: string;
        user_id: string;
        status: string;
        seq: string | number;
      }>(
        `SELECT id, user_id, status, seq FROM registrations WHERE event_id = $1 ORDER BY seq ASC`,
        [eventId],
      );

      const confirmedRows = regRows.rows.filter((r) => r.status === "confirmed");
      const waitlistedRows = regRows.rows.filter((r) => r.status === "waitlisted");

      // Exactly 10 confirmed, 40 waitlisted
      expect(confirmedRows.length).toBe(10);
      expect(waitlistedRows.length).toBe(40);
      expect(regRows.rows.length).toBe(50);

      // Confirmed seq strictly smaller than waitlisted seq
      const confirmedSeqs = confirmedRows.map((r) => Number(r.seq));
      const waitlistedSeqs = waitlistedRows.map((r) => Number(r.seq));
      const maxConfirmedSeq = Math.max(...confirmedSeqs);
      const minWaitlistedSeq = Math.min(...waitlistedSeqs);
      expect(maxConfirmedSeq).toBeLessThan(minWaitlistedSeq);

      // 50 seq values strictly distinct
      const allSeqs = regRows.rows.map((r) => Number(r.seq));
      expect(new Set(allSeqs).size).toBe(50);

      // Invariants:
      // INV-1: confirmed <= capacity
      expect(confirmedRows.length).toBeLessThanOrEqual(10);
      // INV-2: if waitlisted exists, confirmed == capacity
      expect(confirmedRows.length).toBe(10);
      // INV-3: at most 1 active registration per user
      const userActiveRegistrations = new Set(regRows.rows.map((r) => r.user_id));
      expect(userActiveRegistrations.size).toBe(50);
    } finally {
      // Close all worker clients
      await Promise.all(clients.map((c) => c.end().catch(() => {})));
      // Give PostgreSQL backend processes a brief moment to tear down
      await new Promise((r) => setTimeout(r, 100));
      // Assert no d3-worker-* lingering backends
      const lingering = await adminClient.query<{ pid: number }>(
        `SELECT pid FROM pg_stat_activity WHERE application_name LIKE 'd3-worker-%'`,
      );
      expect(lingering.rows.length).toBe(0);
    }
  });

  // --- C2: Same user concurrent 10 calls ---
  it("C2: same user calls register concurrently 10 times, exactly 1 active registration and idempotent responses", async () => {
    const eventId = crypto.randomUUID();
    await adminClient.query(
      `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW() + interval '10 days', NOW() + interval '5 days', 10, 'open', $5, NOW(), NOW())`,
      [eventId, fixtureOrgId, "C2 Event", "Concurrency Event C2", fixtureOwnerId],
    );

    const testUserId = `c2_user_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
    await adminClient.query(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, true, NOW(), NOW())`,
      [testUserId, "C2 User", `${testUserId}@example.com`],
    );
    await adminClient.query(
      `INSERT INTO "member" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, 'member', NOW())`,
      [`mem_${testUserId}`, fixtureOrgId, testUserId],
    );

    const clients: pg.Client[] = [];
    const dbs: Db[] = [];

    try {
      for (let i = 0; i < 10; i++) {
        const client = new pg.Client({
          connectionString: ctx.testDbUrl,
          application_name: `c2-worker-${i}`,
        });
        await client.connect();
        clients.push(client);
        dbs.push(createDbClient(client));
      }

      let startSignal!: () => void;
      const barrier = new Promise<void>((resolve) => {
        startSignal = resolve;
      });

      const promises = clients.map((_, i) => {
        return (async () => {
          await barrier;
          return register(dbs[i], fixtureOrgId, eventId, testUserId);
        })();
      });

      startSignal();
      const results = await Promise.all(promises);

      // Exactly 1 active registration in database
      const regRows = await adminClient.query<{ id: string }>(
        `SELECT id FROM registrations WHERE event_id = $1 AND user_id = $2 AND status IN ('confirmed', 'waitlisted')`,
        [eventId, testUserId],
      );
      expect(regRows.rows.length).toBe(1);
      const activeRegId = regRows.rows[0].id;

      // Exactly 1 returned isCreated = true, 9 returned isCreated = false
      const createdCount = results.filter((r) => r.isCreated).length;
      expect(createdCount).toBe(1);

      // All 10 responses point to the same registration id
      for (const res of results) {
        expect(res.registration.id).toBe(activeRegId);
      }
    } finally {
      for (const c of clients) {
        await c.end().catch(() => {});
      }
    }
  });

  // --- C7: Deterministic interleaving: Connection A holds FOR NO KEY UPDATE, B calls register ---
  it("C7: Connection A holds FOR NO KEY UPDATE while B calls register, observing Lock wait and release", async () => {
    const eventId = crypto.randomUUID();
    await adminClient.query(
      `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW() + interval '10 days', NOW() + interval '5 days', 10, 'open', $5, NOW(), NOW())`,
      [eventId, fixtureOrgId, "C7 Event", "Concurrency Event C7", fixtureOwnerId],
    );

    const userBId = `c7_user_b_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
    await adminClient.query(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, true, NOW(), NOW())`,
      [userBId, "C7 User B", `${userBId}@example.com`],
    );
    await adminClient.query(
      `INSERT INTO "member" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, 'member', NOW())`,
      [`mem_${userBId}`, fixtureOrgId, userBId],
    );

    const clientA = new pg.Client({
      connectionString: ctx.testDbUrl,
      application_name: "c7-A",
    });
    const clientB = new pg.Client({
      connectionString: ctx.testDbUrl,
      application_name: "c7-B",
    });
    const clientObserver = new pg.Client({
      connectionString: ctx.testDbUrl,
      application_name: "c7-observer",
    });

    await clientA.connect();
    await clientB.connect();
    await clientObserver.connect();

    const dbB = createDbClient(clientB);

    try {
      // Get backend PIDs
      const aPidRes = await clientA.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const bPidRes = await clientB.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const aPid = aPidRes.rows[0].pid;
      const bPid = bPidRes.rows[0].pid;

      // 1. Transaction A locks event row with FOR NO KEY UPDATE
      await clientA.query("BEGIN");
      await clientA.query(
        "SELECT id FROM events WHERE id = $1 AND organization_id = $2 FOR NO KEY UPDATE",
        [eventId, fixtureOrgId],
      );

      // 2. Set lock_timeout on B to prevent hanging if bug occurs
      await clientB.query("SET lock_timeout = '30s'");

      // 3. B invokes register (which will block waiting for row lock)
      let bFinished = false;
      let bResult: unknown = null;
      let bError: unknown = null;

      const bPromise = register(dbB, fixtureOrgId, eventId, userBId)
        .then((res) => {
          bFinished = true;
          bResult = res;
        })
        .catch((err) => {
          bFinished = true;
          bError = err;
        });

      // 4. Observer connection polls every 30ms up to 10s
      const observerStartTime = Date.now();
      let lockObserved = false;

      while (Date.now() - observerStartTime < 10000) {
        const statRes = await clientObserver.query<{
          pid: number;
          wait_event_type: string | null;
          wait_event: string | null;
          blocking_pids: number[];
        }>(
          `SELECT pid, wait_event_type, wait_event, pg_blocking_pids(pid) AS blocking_pids
           FROM pg_stat_activity
           WHERE application_name = 'c7-B'`,
        );

        if (statRes.rows.length > 0) {
          const row = statRes.rows[0];
          if (row.wait_event_type === "Lock" && row.blocking_pids.includes(aPid)) {
            lockObserved = true;
            break;
          }
        }
        await new Promise((r) => setTimeout(r, 30));
      }

      if (!lockObserved) {
        // Collect diagnosis before failing
        const statDiag = await clientObserver.query(
          "SELECT pid, application_name, state, wait_event_type, wait_event, query FROM pg_stat_activity",
        );
        const lockDiag = await clientObserver.query(
          "SELECT locktype, relation::regclass, mode, granted, pid FROM pg_locks",
        );
        console.error("C7 Observer Timeout: pg_stat_activity diagnosis:", statDiag.rows);
        console.error("C7 Observer Timeout: pg_locks diagnosis:", lockDiag.rows);
        throw new Error(
          `C7 failed: Observer could not observe B (${bPid}) blocked by A (${aPid}) within 10s`,
        );
      }

      // Assert B has NOT finished and no registration row exists yet
      expect(bFinished).toBe(false);
      const preCommitCount = await clientObserver.query<{ c: number }>(
        "SELECT count(*)::int AS c FROM registrations WHERE event_id = $1 AND user_id = $2",
        [eventId, userBId],
      );
      expect(preCommitCount.rows[0].c).toBe(0);

      // 5. Commit Transaction A to release lock
      await clientA.query("COMMIT");

      // Wait for B to finish
      await bPromise;
      if (bError) throw bError;
      expect(bFinished).toBe(true);
      expect(bResult).toBeDefined();

      // Assert registration row for B now appears in DB
      const postCommitCount = await clientObserver.query<{ c: number }>(
        "SELECT count(*)::int AS c FROM registrations WHERE event_id = $1 AND user_id = $2",
        [eventId, userBId],
      );
      expect(postCommitCount.rows[0].c).toBe(1);
    } finally {
      await clientA.query("ROLLBACK").catch(() => {});
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
      await clientObserver.end().catch(() => {});

      // Give PostgreSQL backend processes a brief moment to tear down
      await new Promise((r) => setTimeout(r, 100));

      // Assert no c7-* lingering backends
      const lingering = await adminClient.query<{ pid: number }>(
        `SELECT pid FROM pg_stat_activity WHERE application_name LIKE 'c7-%'`,
      );
      expect(lingering.rows.length).toBe(0);
    }
  });
});
