import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { setupTestDatabase, type TestDatabaseContext } from "./test-helper.ts";

let app: typeof import("./index.ts").app;

describe("Registrations HTTP Integration Tests (A1, I3, List Counts, I7b Regression)", () => {
  let ctx: TestDatabaseContext;
  let ownerACookie: string;
  let adminACookie: string;
  let memberACookie: string;
  let memberA2Cookie: string;
  let ownerBCookie: string;
  let ownerAId: string;
  let adminAId: string;
  let memberAId: string;
  let memberA2Id: string;
  let ownerBId: string;
  let orgAId: string;
  let orgBId: string;

  beforeAll(async () => {
    ctx = await setupTestDatabase();
    process.env.DATABASE_URL = ctx.testDbUrl;

    const mod = await import("./index.ts");
    app = mod.app;

    async function createUser(
      email: string,
      name: string,
    ): Promise<{ cookie: string; userId: string }> {
      const res = await app.request("http://localhost/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ email, password: "password123456", name }),
      });
      if (!res.ok) {
        throw new Error(`Failed to sign up ${email}: HTTP ${res.status}`);
      }
      const setCookie = res.headers.get("set-cookie") ?? "";
      const cookieMatch = setCookie.match(/better-auth\.session_token=([^;]+)/);
      if (!cookieMatch) {
        throw new Error(`No session cookie returned for ${email}`);
      }
      const cookie = `better-auth.session_token=${cookieMatch[1]}`;

      const sessionRes = await app.request("http://localhost/api/auth/get-session", {
        headers: { cookie },
      });
      const sessionData = (await sessionRes.json()) as { user: { id: string } };
      return { cookie, userId: sessionData.user.id };
    }

    async function createOrg(cookie: string, name: string, slug: string): Promise<string> {
      const res = await app.request("http://localhost/api/auth/organization/create", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          cookie,
        },
        body: JSON.stringify({ name, slug }),
      });
      if (!res.ok) {
        throw new Error(`Failed to create org ${slug}: HTTP ${res.status}`);
      }
      const data = (await res.json()) as { id: string };
      return data.id;
    }

    async function addMember(orgId: string, userId: string, role: string) {
      await ctx.pool.query(
        'INSERT INTO "member" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, NOW())',
        [`mem_${Date.now()}_${Math.random()}`, orgId, userId, role],
      );
    }

    const ownerA = await createUser("reg-owner-a@example.com", "Reg Owner A");
    const adminA = await createUser("reg-admin-a@example.com", "Reg Admin A");
    const memberA = await createUser("reg-member-a@example.com", "Reg Member A");
    const memberA2 = await createUser("reg-member-a2@example.com", "Reg Member A2");
    const ownerB = await createUser("reg-owner-b@example.com", "Reg Owner B");

    ownerACookie = ownerA.cookie;
    adminACookie = adminA.cookie;
    memberACookie = memberA.cookie;
    memberA2Cookie = memberA2.cookie;
    ownerBCookie = ownerB.cookie;

    ownerAId = ownerA.userId;
    adminAId = adminA.userId;
    memberAId = memberA.userId;
    memberA2Id = memberA2.userId;
    ownerBId = ownerB.userId;

    orgAId = await createOrg(ownerACookie, "Reg Org A", `reg-org-a-${Date.now()}`);
    orgBId = await createOrg(ownerBCookie, "Reg Org B", `reg-org-b-${Date.now()}`);

    await addMember(orgAId, adminAId, "admin");
    await addMember(orgAId, memberAId, "member");
    await addMember(orgAId, memberA2Id, "member");
  });

  afterAll(async () => {
    if (ctx) {
      await ctx.cleanup();
    }
  });

  // --- Suite 1: A1 API Registration Contract (POST /api/orgs/:orgId/events/:eventId/registrations) ---

  describe("A1: Registration HTTP Endpoints", () => {
    it("allows member+ to register: first time returns 201 with registration DTO, no seq, no organizationId", async () => {
      const eventId = crypto.randomUUID();
      await ctx.pool.query(
        `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW() + interval '10 days', NOW() + interval '5 days', 10, 'open', $5, NOW(), NOW())`,
        [eventId, orgAId, "A1 Standard Event", "Event for registration", ownerAId],
      );

      const res = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${eventId}/registrations`,
        {
          method: "POST",
          headers: { cookie: memberACookie },
        },
      );

      expect(res.status).toBe(201);
      const data = (await res.json()) as Record<string, unknown>;

      // Expected fields: id, eventId, userId, status, createdAt
      expect(data).toHaveProperty("id");
      expect(data.eventId).toBe(eventId);
      expect(data.userId).toBe(memberAId);
      expect(data.status).toBe("confirmed");
      expect(data).toHaveProperty("createdAt");

      // Strictly assert response body does NOT leak seq or organizationId
      expect(data.seq).toBeUndefined();
      expect(data.organizationId).toBeUndefined();
      expect(data.organization_id).toBeUndefined();
    });

    it("returns 200 with identical registration ID for duplicate registration by same user", async () => {
      const eventId = crypto.randomUUID();
      await ctx.pool.query(
        `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW() + interval '10 days', NOW() + interval '5 days', 10, 'open', $5, NOW(), NOW())`,
        [eventId, orgAId, "A1 Duplicate Event", "Event for duplicate check", ownerAId],
      );

      // 1. First registration -> 201
      const res1 = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${eventId}/registrations`,
        {
          method: "POST",
          headers: { cookie: memberACookie },
        },
      );
      expect(res1.status).toBe(201);
      const data1 = (await res1.json()) as { id: string };

      // 2. Second registration -> 200 with same id
      const res2 = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${eventId}/registrations`,
        {
          method: "POST",
          headers: { cookie: memberACookie },
        },
      );
      expect(res2.status).toBe(200);
      const data2 = (await res2.json()) as { id: string };
      expect(data2.id).toBe(data1.id);
    });

    it("returns 200 for existing registrant after deadline, but 409 REGISTRATION_CLOSED for new user (database unchanged)", async () => {
      const eventId = crypto.randomUUID();
      // Initially open event
      await ctx.pool.query(
        `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW() + interval '10 days', NOW() + interval '5 days', 10, 'open', $5, NOW(), NOW())`,
        [eventId, orgAId, "A1 Deadline Event", "Event for deadline check", ownerAId],
      );

      // Member A registers before deadline
      const resBefore = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${eventId}/registrations`,
        {
          method: "POST",
          headers: { cookie: memberACookie },
        },
      );
      expect(resBefore.status).toBe(201);
      const regBefore = (await resBefore.json()) as { id: string };

      // /* 底层夹具 */: update registration_deadline to the past
      await ctx.pool.query(
        `UPDATE events SET registration_deadline = NOW() - interval '1 hour' WHERE id = $1`,
        [eventId],
      );

      // Snapshot registrations before test
      const regCountBefore = await ctx.pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM registrations WHERE event_id = $1`,
        [eventId],
      );

      // Member A (existing registrant) registers again after deadline -> returns 200 and same ID
      const resRepeat = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${eventId}/registrations`,
        {
          method: "POST",
          headers: { cookie: memberACookie },
        },
      );
      expect(resRepeat.status).toBe(200);
      const regRepeat = (await resRepeat.json()) as { id: string };
      expect(regRepeat.id).toBe(regBefore.id);

      // Member A2 (new user) registers after deadline -> 409 REGISTRATION_CLOSED
      const resNew = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${eventId}/registrations`,
        {
          method: "POST",
          headers: { cookie: memberA2Cookie },
        },
      );
      expect(resNew.status).toBe(409);
      const newErr = (await resNew.json()) as { error: { code: string; message: string } };
      expect(newErr.error.code).toBe("REGISTRATION_CLOSED");

      // Assert database registrations count unchanged
      const regCountAfter = await ctx.pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM registrations WHERE event_id = $1`,
        [eventId],
      );
      expect(regCountAfter.rows[0].c).toBe(regCountBefore.rows[0].c);
    });

    it("returns 409 EVENT_STARTED when event starts_at is in the past (database unchanged)", async () => {
      const eventId = crypto.randomUUID();
      // /* 底层夹具 */: starts_at and deadline in the past
      await ctx.pool.query(
        `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW() - interval '10 minutes', NOW() - interval '20 minutes', 10, 'open', $5, NOW(), NOW())`,
        [eventId, orgAId, "A1 Started Event", "Event in past", ownerAId],
      );

      const regCountBefore = await ctx.pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM registrations WHERE event_id = $1`,
        [eventId],
      );

      const res = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${eventId}/registrations`,
        {
          method: "POST",
          headers: { cookie: memberACookie },
        },
      );
      expect(res.status).toBe(409);
      const err = (await res.json()) as { error: { code: string; message: string } };
      expect(err.error.code).toBe("EVENT_STARTED");

      const regCountAfter = await ctx.pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM registrations WHERE event_id = $1`,
        [eventId],
      );
      expect(regCountAfter.rows[0].c).toBe(regCountBefore.rows[0].c);
    });

    it("returns 409 EVENT_STARTED when existing registrant attempts to register after event starts (database unchanged)", async () => {
      const eventId = crypto.randomUUID();
      await ctx.pool.query(
        `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW() + interval '10 days', NOW() + interval '5 days', 10, 'open', $5, NOW(), NOW())`,
        [
          eventId,
          orgAId,
          "A1 Existing Registrant Started Event",
          "Event for started check with existing reg",
          ownerAId,
        ],
      );

      // 1. Initial valid registration -> 201
      const res1 = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${eventId}/registrations`,
        {
          method: "POST",
          headers: { cookie: memberACookie },
        },
      );
      expect(res1.status).toBe(201);

      // Snapshot registrations before test
      const regSnapBefore = await ctx.pool.query(
        `SELECT id, event_id, organization_id, user_id, status FROM registrations WHERE event_id = $1 ORDER BY id`,
        [eventId],
      );

      // /* 底层夹具 */: update starts_at and registration_deadline to the past
      await ctx.pool.query(
        `UPDATE events SET starts_at = NOW() - interval '10 minutes', registration_deadline = NOW() - interval '20 minutes' WHERE id = $1`,
        [eventId],
      );

      // 2. Member A attempts to register again after event starts -> 409 EVENT_STARTED
      const res2 = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${eventId}/registrations`,
        {
          method: "POST",
          headers: { cookie: memberACookie },
        },
      );
      expect(res2.status).toBe(409);
      const err = (await res2.json()) as { error: { code: string; message: string } };
      expect(err.error.code).toBe("EVENT_STARTED");

      // Assert database state unchanged
      const regSnapAfter = await ctx.pool.query(
        `SELECT id, event_id, organization_id, user_id, status FROM registrations WHERE event_id = $1 ORDER BY id`,
        [eventId],
      );
      expect(regSnapAfter.rows).toEqual(regSnapBefore.rows);
    });

    it("returns 409 EVENT_CANCELLED when event is cancelled (database unchanged)", async () => {
      const eventId = crypto.randomUUID();
      // /* 底层夹具 */: status = 'cancelled'
      await ctx.pool.query(
        `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW() + interval '10 days', NOW() + interval '5 days', 10, 'cancelled', $5, NOW(), NOW())`,
        [eventId, orgAId, "A1 Cancelled Event", "Event cancelled", ownerAId],
      );

      const regCountBefore = await ctx.pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM registrations WHERE event_id = $1`,
        [eventId],
      );

      const res = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${eventId}/registrations`,
        {
          method: "POST",
          headers: { cookie: memberACookie },
        },
      );
      expect(res.status).toBe(409);
      const err = (await res.json()) as { error: { code: string; message: string } };
      expect(err.error.code).toBe("EVENT_CANCELLED");

      const regCountAfter = await ctx.pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM registrations WHERE event_id = $1`,
        [eventId],
      );
      expect(regCountAfter.rows[0].c).toBe(regCountBefore.rows[0].c);
    });

    it("returns 409 EVENT_CANCELLED when existing registrant attempts to register after event cancelled (database unchanged)", async () => {
      const eventId = crypto.randomUUID();
      await ctx.pool.query(
        `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW() + interval '10 days', NOW() + interval '5 days', 10, 'open', $5, NOW(), NOW())`,
        [
          eventId,
          orgAId,
          "A1 Existing Registrant Cancelled Event",
          "Event for cancelled check with existing reg",
          ownerAId,
        ],
      );

      // 1. Initial valid registration -> 201
      const res1 = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${eventId}/registrations`,
        {
          method: "POST",
          headers: { cookie: memberACookie },
        },
      );
      expect(res1.status).toBe(201);

      // Snapshot registrations before test
      const regSnapBefore = await ctx.pool.query(
        `SELECT id, event_id, organization_id, user_id, status FROM registrations WHERE event_id = $1 ORDER BY id`,
        [eventId],
      );

      // /* 底层夹具 */: update status to 'cancelled'
      await ctx.pool.query(`UPDATE events SET status = 'cancelled' WHERE id = $1`, [eventId]);

      // 2. Member A attempts to register again after event cancelled -> 409 EVENT_CANCELLED
      const res2 = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${eventId}/registrations`,
        {
          method: "POST",
          headers: { cookie: memberACookie },
        },
      );
      expect(res2.status).toBe(409);
      const err = (await res2.json()) as { error: { code: string; message: string } };
      expect(err.error.code).toBe("EVENT_CANCELLED");

      // Assert database state unchanged
      const regSnapAfter = await ctx.pool.query(
        `SELECT id, event_id, organization_id, user_id, status FROM registrations WHERE event_id = $1 ORDER BY id`,
        [eventId],
      );
      expect(regSnapAfter.rows).toEqual(regSnapBefore.rows);
    });

    it("precedence test: returns 409 EVENT_CANCELLED when event is both cancelled AND started", async () => {
      const eventId = crypto.randomUUID();
      // /* 底层夹具 */: status = 'cancelled' AND starts_at in the past
      await ctx.pool.query(
        `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW() - interval '1 hour', NOW() - interval '2 hours', 10, 'cancelled', $5, NOW(), NOW())`,
        [eventId, orgAId, "A1 Cancelled & Started Event", "Precedence check", ownerAId],
      );

      const res = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${eventId}/registrations`,
        {
          method: "POST",
          headers: { cookie: memberACookie },
        },
      );
      expect(res.status).toBe(409);
      const err = (await res.json()) as { error: { code: string; message: string } };
      // Precedence requirement: check cancelled before started
      expect(err.error.code).toBe("EVENT_CANCELLED");
    });

    it("rejects invalid eventId format (not uuid) with 400 VALIDATION (database unchanged)", async () => {
      const regCountBefore = await ctx.pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM registrations`,
      );

      const res = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/invalid-uuid-format/registrations`,
        {
          method: "POST",
          headers: { cookie: memberACookie },
        },
      );
      expect(res.status).toBe(400);
      const err = (await res.json()) as { error: { code: string; message: string } };
      expect(err.error.code).toBe("VALIDATION");

      const regCountAfter = await ctx.pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM registrations`,
      );
      expect(regCountAfter.rows[0].c).toBe(regCountBefore.rows[0].c);
    });

    it("returns 401 UNAUTHENTICATED when unauthenticated", async () => {
      const eventId = crypto.randomUUID();
      const res = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${eventId}/registrations`,
        { method: "POST" },
      );
      expect(res.status).toBe(401);
      const err = (await res.json()) as { error: { code: string; message: string } };
      expect(err.error.code).toBe("UNAUTHENTICATED");
    });

    it("returns 403 FORBIDDEN when user is not member of target organization", async () => {
      const eventId = crypto.randomUUID();
      // Owner B attempts to register for event in Org A
      const res = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${eventId}/registrations`,
        {
          method: "POST",
          headers: { cookie: ownerBCookie },
        },
      );
      expect(res.status).toBe(403);
      const err = (await res.json()) as { error: { code: string; message: string } };
      expect(err.error.code).toBe("FORBIDDEN");
    });
  });

  // --- Suite 2: I3 Cross-Organization Isolation ---

  describe("I3: Cross-Organization Isolation for Registrations", () => {
    it("I3: Org A admin using Org B event ID returns 404 NOT_FOUND, database unchanged, with positive control", async () => {
      // Setup fixtures: two open events, far future (+30d, +29d), capacity >= 2, no registrations
      const eventAId = crypto.randomUUID();
      const eventBId = crypto.randomUUID();

      await ctx.pool.query(
        `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW() + interval '30 days', NOW() + interval '29 days', 5, 'open', $5, NOW(), NOW())`,
        [eventAId, orgAId, "Org A Far Future Event", "Event in Org A", ownerAId],
      );

      await ctx.pool.query(
        `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW() + interval '30 days', NOW() + interval '29 days', 5, 'open', $5, NOW(), NOW())`,
        [eventBId, orgBId, "Org B Far Future Event", "Event in Org B", ownerBId],
      );

      // Verify Admin A has no registration in either event
      const initialRegCheck = await ctx.pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM registrations WHERE user_id = $1 AND event_id IN ($2, $3)`,
        [adminAId, eventAId, eventBId],
      );
      expect(initialRegCheck.rows[0].c).toBe(0);

      // Pre-request snapshot of both tables
      const preSnapEvents = await ctx.pool.query(
        `SELECT * FROM events WHERE id IN ($1, $2) ORDER BY id`,
        [eventAId, eventBId],
      );
      const preSnapRegs = await ctx.pool.query(
        `SELECT * FROM registrations WHERE event_id IN ($1, $2) ORDER BY id`,
        [eventAId, eventBId],
      );

      // 1. Send rejected request: Admin A calls /api/orgs/<OrgA>/events/<EventB>/registrations
      // Capture response without asserting yet
      const rejectedRes = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${eventBId}/registrations`,
        {
          method: "POST",
          headers: { cookie: adminACookie },
        },
      );

      // 2. Post-request snapshot
      const postSnapEvents = await ctx.pool.query(
        `SELECT * FROM events WHERE id IN ($1, $2) ORDER BY id`,
        [eventAId, eventBId],
      );
      const postSnapRegs = await ctx.pool.query(
        `SELECT * FROM registrations WHERE event_id IN ($1, $2) ORDER BY id`,
        [eventAId, eventBId],
      );

      // 3. Persist evidence to disk
      const evidencePath = path.resolve(process.cwd(), "tmp_i3_evidence.json");
      fs.writeFileSync(
        evidencePath,
        JSON.stringify(
          {
            status: rejectedRes.status,
            preEvents: preSnapEvents.rows,
            postEvents: postSnapEvents.rows,
            preRegs: preSnapRegs.rows,
            postRegs: postSnapRegs.rows,
          },
          null,
          2,
        ),
      );

      // 4. Positive control: Admin A registers for Org A's own event -> 201 Created and adds exactly 1 row
      const controlRes = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${eventAId}/registrations`,
        {
          method: "POST",
          headers: { cookie: adminACookie },
        },
      );
      expect(controlRes.status).toBe(201);
      const controlCount = await ctx.pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM registrations WHERE event_id = $1 AND user_id = $2`,
        [eventAId, adminAId],
      );
      expect(controlCount.rows[0].c).toBe(1);

      // Clean up evidence file
      try {
        fs.unlinkSync(evidencePath);
      } catch {}

      // 5. Unified assertions on rejected call
      expect(rejectedRes.status).toBe(404);
      const errBody = (await rejectedRes.json()) as { error: { code: string; message: string } };
      expect(errBody.error.code).toBe("NOT_FOUND");
      expect(postSnapEvents.rows).toEqual(preSnapEvents.rows);
      expect(postSnapRegs.rows).toEqual(preSnapRegs.rows);
    });

    it("I3: Org A event ID with Org B registration ID returns 404 NOT_FOUND, registration row unchanged", async () => {
      const eventAId = crypto.randomUUID();
      const eventBId = crypto.randomUUID();

      await ctx.pool.query(
        `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
         VALUES ($1, $2, 'Org A Event', 'Event in Org A', NOW() + interval '30 days', NOW() + interval '29 days', 5, 'open', $3, NOW(), NOW())`,
        [eventAId, orgAId, ownerAId],
      );

      await ctx.pool.query(
        `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
         VALUES ($1, $2, 'Org B Event', 'Event in Org B', NOW() + interval '30 days', NOW() + interval '29 days', 5, 'open', $3, NOW(), NOW())`,
        [eventBId, orgBId, ownerBId],
      );

      const regBId = crypto.randomUUID();
      await ctx.pool.query(
        `INSERT INTO registrations (id, event_id, organization_id, user_id, status, created_at)
         VALUES ($1, $2, $3, $4, 'confirmed', NOW())`,
        [regBId, eventBId, orgBId, ownerBId],
      );

      const regBSnapBefore = await ctx.pool.query(`SELECT * FROM registrations WHERE id = $1`, [
        regBId,
      ]);

      const res = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${eventAId}/registrations/${regBId}`,
        {
          method: "DELETE",
          headers: { cookie: adminACookie },
        },
      );
      expect(res.status).toBe(404);
      const json = (await res.json()) as { error: { code: string; message: string } };
      expect(json.error.code).toBe("NOT_FOUND");

      const regBSnapAfter = await ctx.pool.query(`SELECT * FROM registrations WHERE id = $1`, [
        regBId,
      ]);
      expect(regBSnapAfter.rows).toEqual(regBSnapBefore.rows);
    });
  });

  // --- Suite 3: Real Event Listing Counts (GET /api/orgs/:orgId/events) ---

  describe("Real Event Listing Counts (confirmedCount, waitlistedCount)", () => {
    it("returns confirmedCount and waitlistedCount correctly (0/0 when empty, ignores cancelled, isolated per org)", async () => {
      // Event 1 in Org A: no registrations -> 0/0
      const evt1Id = crypto.randomUUID();
      await ctx.pool.query(
        `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW() + interval '10 days', NOW() + interval '5 days', 10, 'open', $5, NOW(), NOW())`,
        [evt1Id, orgAId, "Listing Count Evt 1", "No registrations", ownerAId],
      );

      // Event 2 in Org A: 2 confirmed, 1 waitlisted, 1 cancelled (via SQL fixture)
      const evt2Id = crypto.randomUUID();
      await ctx.pool.query(
        `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW() + interval '10 days', NOW() + interval '5 days', 2, 'open', $5, NOW(), NOW())`,
        [evt2Id, orgAId, "Listing Count Evt 2", "With registrations", ownerAId],
      );

      // Event 3 in Org B: cross-org registrations (must not affect Org A)
      const evt3Id = crypto.randomUUID();
      await ctx.pool.query(
        `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW() + interval '10 days', NOW() + interval '5 days', 5, 'open', $5, NOW(), NOW())`,
        [evt3Id, orgBId, "Listing Count Evt 3 Org B", "Cross-org test", ownerBId],
      );

      // Insert registrations for Evt 2 in Org A
      await ctx.pool.query(
        `INSERT INTO registrations (event_id, organization_id, user_id, status) VALUES ($1, $2, $3, 'confirmed')`,
        [evt2Id, orgAId, memberAId],
      );
      await ctx.pool.query(
        `INSERT INTO registrations (event_id, organization_id, user_id, status) VALUES ($1, $2, $3, 'confirmed')`,
        [evt2Id, orgAId, memberA2Id],
      );
      await ctx.pool.query(
        `INSERT INTO registrations (event_id, organization_id, user_id, status) VALUES ($1, $2, $3, 'waitlisted')`,
        [evt2Id, orgAId, adminAId],
      );
      // Cancelled row via SQL fixture
      await ctx.pool.query(
        `INSERT INTO registrations (event_id, organization_id, user_id, status, cancelled_at) VALUES ($1, $2, $3, 'cancelled', NOW())`,
        [evt2Id, orgAId, ownerAId],
      );

      // Insert registrations for Evt 3 in Org B
      await ctx.pool.query(
        `INSERT INTO registrations (event_id, organization_id, user_id, status) VALUES ($1, $2, $3, 'confirmed')`,
        [evt3Id, orgBId, ownerBId],
      );

      // Call GET /api/orgs/:orgId/events for Org A
      const res = await app.request(`http://localhost/api/orgs/${orgAId}/events`, {
        method: "GET",
        headers: { cookie: memberACookie },
      });
      expect(res.status).toBe(200);
      const events = (await res.json()) as Array<{
        id: string;
        confirmedCount: number;
        waitlistedCount: number;
      }>;

      const evt1 = events.find((e) => e.id === evt1Id);
      expect(evt1).toBeDefined();
      expect(evt1!.confirmedCount).toBe(0);
      expect(evt1!.waitlistedCount).toBe(0);

      const evt2 = events.find((e) => e.id === evt2Id);
      expect(evt2).toBeDefined();
      expect(evt2!.confirmedCount).toBe(2);
      expect(evt2!.waitlistedCount).toBe(1);

      // Org isolation: assert Org B event (evt3Id) is not in the response
      const evt3 = events.find((e) => e.id === evt3Id);
      expect(evt3).toBeUndefined();
      expect(events.some((e) => e.id === evt3Id)).toBe(false);
    });
  });

  // --- Suite 4: I7(b) Regression with Registrations Present ---

  describe("I7(b) Regression: Org Deletion Disabled when Events and Registrations Present", () => {
    it("rejects owner attempting to delete organization when events and registrations exist with 404 ORGANIZATION_DELETION_DISABLED, row counts unchanged", async () => {
      // 1. Setup event and registration in Org A
      const eventId = crypto.randomUUID();
      await ctx.pool.query(
        `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW() + interval '10 days', NOW() + interval '5 days', 10, 'open', $5, NOW(), NOW())`,
        [eventId, orgAId, "I7b Event", "For I7b regression", ownerAId],
      );

      await ctx.pool.query(
        `INSERT INTO registrations (event_id, organization_id, user_id, status) VALUES ($1, $2, $3, 'confirmed')`,
        [eventId, orgAId, memberAId],
      );

      // 2. Pre-deletion counts of events and registrations
      const eventsBefore = await ctx.pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM events WHERE organization_id = $1`,
        [orgAId],
      );
      const regsBefore = await ctx.pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM registrations WHERE organization_id = $1`,
        [orgAId],
      );
      expect(eventsBefore.rows[0].c).toBeGreaterThan(0);
      expect(regsBefore.rows[0].c).toBeGreaterThan(0);

      // 3. Owner calls DELETE organization endpoint
      const res = await app.request("http://localhost/api/auth/organization/delete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          cookie: ownerACookie,
        },
        body: JSON.stringify({ organizationId: orgAId }),
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { code: string; message: string };
      expect(body.code).toBe("ORGANIZATION_DELETION_DISABLED");

      // 4. Post-deletion counts must remain completely unchanged
      const eventsAfter = await ctx.pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM events WHERE organization_id = $1`,
        [orgAId],
      );
      const regsAfter = await ctx.pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM registrations WHERE organization_id = $1`,
        [orgAId],
      );
      expect(eventsAfter.rows[0].c).toBe(eventsBefore.rows[0].c);
      expect(regsAfter.rows[0].c).toBe(regsBefore.rows[0].c);
    });
  });
});
