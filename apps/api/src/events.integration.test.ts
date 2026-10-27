import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { isPostgresDatabaseError, type PostgresDatabaseError } from "./db-error-helper.ts";
import { setupTestDatabase, type TestDatabaseContext } from "./test-helper.ts";

let app: typeof import("./index.ts").app;
let db: typeof import("./auth.ts").db;

describe("S2 Events Integration & Isolation Tests (A1, I1, I4, H-Reach, L5)", () => {
  let ctx: TestDatabaseContext;
  let ownerACookie: string;
  let adminACookie: string;
  let memberACookie: string;
  let ownerBCookie: string;
  let ownerAId: string;
  let adminAId: string;
  let memberAId: string;
  let orgAId: string;
  let orgBId: string;

  beforeAll(async () => {
    ctx = await setupTestDatabase();
    process.env.DATABASE_URL = ctx.testDbUrl;

    const mod = await import("./index.ts");
    app = mod.app;
    const authMod = await import("./auth.ts");
    db = authMod.db;

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

    const ownerA = await createUser("events-owner-a@example.com", "Owner A");
    const adminA = await createUser("events-admin-a@example.com", "Admin A");
    const memberA = await createUser("events-member-a@example.com", "Member A");
    const ownerB = await createUser("events-owner-b@example.com", "Owner B");

    ownerACookie = ownerA.cookie;
    adminACookie = adminA.cookie;
    memberACookie = memberA.cookie;
    ownerBCookie = ownerB.cookie;

    ownerAId = ownerA.userId;
    adminAId = adminA.userId;
    memberAId = memberA.userId;

    orgAId = await createOrg(ownerACookie, "Events Org A", `events-org-a-${Date.now()}`);
    orgBId = await createOrg(ownerBCookie, "Events Org B", `events-org-b-${Date.now()}`);

    await addMember(orgAId, adminAId, "admin");
    await addMember(orgAId, memberAId, "member");
  });

  afterAll(async () => {
    if (ctx) {
      await ctx.cleanup();
    }
  });

  // --- Suite 1: Event Creation (POST /api/orgs/:orgId/events) ---

  describe("A1: Event Creation (POST /api/orgs/:orgId/events)", () => {
    it("creates an event successfully with HTTP 201 when called by owner with valid payload", async () => {
      const baseTime = Date.now();
      const startsAt = new Date(baseTime + 10 * 86400000).toISOString();
      const registrationDeadline = new Date(baseTime + 5 * 86400000).toISOString();

      const payload = {
        title: "Annual Tech Summit",
        description: "Official tech summit for all engineering teams",
        startsAt,
        registrationDeadline,
        capacity: 100,
      };

      const res = await app.request(`http://localhost/api/orgs/${orgAId}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ownerACookie,
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as Record<string, unknown>;

      expect(data).toHaveProperty("id");
      expect(typeof data.id).toBe("string");
      expect(data.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(data.organizationId).toBe(orgAId);
      expect(data.title).toBe(payload.title);
      expect(data.description).toBe(payload.description);
      expect(new Date(data.startsAt as string).toISOString()).toBe(startsAt);
      expect(new Date(data.registrationDeadline as string).toISOString()).toBe(
        registrationDeadline,
      );
      expect(data.capacity).toBe(100);
      expect(data.status).toBe("open");
      expect(data.createdBy).toBe(ownerAId);
      expect(data).toHaveProperty("createdAt");
      expect(data).toHaveProperty("updatedAt");
    });

    it("creates an event successfully when called by admin (role threshold: admin+)", async () => {
      const baseTime = Date.now();
      const startsAt = new Date(baseTime + 15 * 86400000).toISOString();
      const registrationDeadline = new Date(baseTime + 12 * 86400000).toISOString();

      const payload = {
        title: "Admin Created Workshop",
        startsAt,
        registrationDeadline,
        capacity: 50,
      };

      const res = await app.request(`http://localhost/api/orgs/${orgAId}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: adminACookie,
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.createdBy).toBe(adminAId);
      expect(data.organizationId).toBe(orgAId);
    });

    it("creates an event successfully with maximum title length (120 characters, DEV-S2-01 upper boundary)", async () => {
      const baseTime = Date.now();
      const startsAt = new Date(baseTime + 10 * 86400000).toISOString();
      const registrationDeadline = new Date(baseTime + 5 * 86400000).toISOString();

      const payload = {
        title: "T".repeat(120),
        startsAt,
        registrationDeadline,
        capacity: 10,
      };

      const res = await app.request(`http://localhost/api/orgs/${orgAId}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ownerACookie,
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.title).toBe(payload.title);
    });

    it("creates an event successfully with minimum capacity (capacity=1, lower boundary)", async () => {
      const baseTime = Date.now();
      const startsAt = new Date(baseTime + 10 * 86400000).toISOString();
      const registrationDeadline = new Date(baseTime + 5 * 86400000).toISOString();

      const payload = {
        title: "Min Capacity Event",
        startsAt,
        registrationDeadline,
        capacity: 1,
      };

      const res = await app.request(`http://localhost/api/orgs/${orgAId}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ownerACookie,
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.capacity).toBe(1);
    });

    it("creates an event successfully with maximum capacity (capacity=1000, upper boundary)", async () => {
      const baseTime = Date.now();
      const startsAt = new Date(baseTime + 10 * 86400000).toISOString();
      const registrationDeadline = new Date(baseTime + 5 * 86400000).toISOString();

      const payload = {
        title: "Max Capacity Event",
        startsAt,
        registrationDeadline,
        capacity: 1000,
      };

      const res = await app.request(`http://localhost/api/orgs/${orgAId}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ownerACookie,
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.capacity).toBe(1000);
    });

    it("creates an event successfully when registrationDeadline equals startsAt (BR-3 boundary)", async () => {
      const baseTime = Date.now();
      const sameTime = new Date(baseTime + 10 * 86400000).toISOString();

      const payload = {
        title: "Equal Deadline and Start Event",
        startsAt: sameTime,
        registrationDeadline: sameTime,
        capacity: 50,
      };

      const res = await app.request(`http://localhost/api/orgs/${orgAId}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ownerACookie,
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as Record<string, unknown>;
      expect(new Date(data.startsAt as string).toISOString()).toBe(sameTime);
      expect(new Date(data.registrationDeadline as string).toISOString()).toBe(sameTime);
    });

    it("creates an event successfully when description is explicitly null (PRD BR-3 nullable requirement)", async () => {
      const baseTime = Date.now();
      const payload = {
        title: "Null Description Event",
        description: null,
        startsAt: new Date(baseTime + 10 * 86400000).toISOString(),
        registrationDeadline: new Date(baseTime + 5 * 86400000).toISOString(),
        capacity: 10,
      };

      const res = await app.request(`http://localhost/api/orgs/${orgAId}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ownerACookie,
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.description).toBeNull();
    });

    it("creates an event successfully when description is omitted from request body", async () => {
      const baseTime = Date.now();
      const payload = {
        title: "Omitted Description Event",
        startsAt: new Date(baseTime + 10 * 86400000).toISOString(),
        registrationDeadline: new Date(baseTime + 5 * 86400000).toISOString(),
        capacity: 10,
      };

      const res = await app.request(`http://localhost/api/orgs/${orgAId}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ownerACookie,
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.description).toBeNull();
    });

    it("creates an event successfully when startsAt and registrationDeadline use non-UTC timezone offsets", async () => {
      const startsAtWithOffset = "2026-11-10T18:00:00+09:00";
      const deadlineWithOffset = "2026-11-10T04:00:00-05:00";

      const payload = {
        title: "Timezone Offset Event",
        startsAt: startsAtWithOffset,
        registrationDeadline: deadlineWithOffset,
        capacity: 20,
      };

      const res = await app.request(`http://localhost/api/orgs/${orgAId}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ownerACookie,
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as Record<string, unknown>;
      expect(new Date(data.startsAt as string).toISOString()).toBe("2026-11-10T09:00:00.000Z");
      expect(new Date(data.registrationDeadline as string).toISOString()).toBe(
        "2026-11-10T09:00:00.000Z",
      );
    });

    it("rejects event creation when registrationDeadline is strictly 1 millisecond after startsAt (BR-3 strict millisecond boundary)", async () => {
      const baseTime = Date.now();
      const startsAtEpoch = baseTime + 10 * 86400000;
      const startsAt = new Date(startsAtEpoch).toISOString();
      const deadline = new Date(startsAtEpoch + 1).toISOString();

      const payload = {
        title: "Sub-millisecond Violation Event",
        startsAt,
        registrationDeadline: deadline,
        capacity: 10,
      };

      const res = await app.request(`http://localhost/api/orgs/${orgAId}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ownerACookie,
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: { code: string; message: string } };
      expect(data.error.code).toBe("VALIDATION");
      expect(data.error.message).toContain("Registration deadline cannot be after start time");
    });

    it("returns 500 INTERNAL_ERROR when transaction fails during event creation, never leaking SQL or credentials", async () => {
      const txSpy = vi.spyOn(db, "transaction").mockImplementationOnce(() => {
        throw new Error(
          "Simulated database transaction failure: SELECT * FROM secret_internal_table; password=secret123 host=10.0.0.1",
        );
      });

      try {
        const payload = {
          title: "Fault Injection Event",
          startsAt: new Date(Date.now() + 10 * 86400000).toISOString(),
          registrationDeadline: new Date(Date.now() + 5 * 86400000).toISOString(),
          capacity: 10,
        };

        const res = await app.request(`http://localhost/api/orgs/${orgAId}/events`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: ownerACookie,
          },
          body: JSON.stringify(payload),
        });

        expect(res.status).toBe(500);
        const data = (await res.json()) as { error: { code: string; message: string } };
        expect(data).toEqual({
          error: {
            code: "INTERNAL_ERROR",
            message: "Failed to create event",
          },
        });
        expect(data.error.message).not.toContain("secret_internal_table");
        expect(data.error.message).not.toContain("password");
        expect(data.error.message).not.toContain("10.0.0.1");
      } finally {
        txSpy.mockRestore();
      }
    });

    it("enforces URL path isolation: ignores organizationId in request body and binds to path :orgId", async () => {
      const baseTime = Date.now();
      const payload = {
        organizationId: orgBId, // Attempted forgery: body specifies Org B
        organization_id: orgBId,
        title: "Path Isolation Check",
        startsAt: new Date(baseTime + 10 * 86400000).toISOString(),
        registrationDeadline: new Date(baseTime + 5 * 86400000).toISOString(),
        capacity: 25,
      };

      const res = await app.request(`http://localhost/api/orgs/${orgAId}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ownerACookie,
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as Record<string, unknown>;
      // Must be bound to path orgAId, NOT body orgBId
      expect(data.organizationId).toBe(orgAId);
    });

    it("enforces session context isolation: ignores createdBy in request body and binds to auth user", async () => {
      const baseTime = Date.now();
      const payload = {
        createdBy: "forged_user_id_12345",
        created_by: "forged_user_id_12345",
        title: "CreatedBy Isolation Check",
        startsAt: new Date(baseTime + 10 * 86400000).toISOString(),
        registrationDeadline: new Date(baseTime + 5 * 86400000).toISOString(),
        capacity: 20,
      };

      const res = await app.request(`http://localhost/api/orgs/${orgAId}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ownerACookie,
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.createdBy).toBe(ownerAId);
    });

    it("I4: rejects member role attempting to create event with 403 FORBIDDEN", async () => {
      const baseTime = Date.now();
      const payload = {
        title: "Member Illegal Event",
        startsAt: new Date(baseTime + 10 * 86400000).toISOString(),
        registrationDeadline: new Date(baseTime + 5 * 86400000).toISOString(),
        capacity: 10,
      };

      const res = await app.request(`http://localhost/api/orgs/${orgAId}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: memberACookie,
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(403);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({
        error: {
          code: "FORBIDDEN",
          message: expect.any(String),
        },
      });
    });

    it("I1: rejects unauthenticated creation request with 401 UNAUTHENTICATED", async () => {
      const baseTime = Date.now();
      const payload = {
        title: "Unauth Event",
        startsAt: new Date(baseTime + 10 * 86400000).toISOString(),
        registrationDeadline: new Date(baseTime + 5 * 86400000).toISOString(),
        capacity: 10,
      };

      const res = await app.request(`http://localhost/api/orgs/${orgAId}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({
        error: {
          code: "UNAUTHENTICATED",
          message: expect.any(String),
        },
      });
    });

    it("I2: rejects non-member of target org with 403 FORBIDDEN", async () => {
      const baseTime = Date.now();
      const payload = {
        title: "Cross-Org Event",
        startsAt: new Date(baseTime + 10 * 86400000).toISOString(),
        registrationDeadline: new Date(baseTime + 5 * 86400000).toISOString(),
        capacity: 10,
      };

      // Owner B attempts to create event in Org A
      const res = await app.request(`http://localhost/api/orgs/${orgAId}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ownerBCookie,
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(403);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({
        error: {
          code: "FORBIDDEN",
          message: expect.any(String),
        },
      });
    });

    // --- Validation Rules (400 VALIDATION) ---

    describe("Input Validation & Error Envelope (400 VALIDATION)", () => {
      async function assertValidationFailure(payload: Record<string, unknown>) {
        const res = await app.request(`http://localhost/api/orgs/${orgAId}/events`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: ownerACookie,
          },
          body: JSON.stringify(payload),
        });

        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: { code: string; message: string } };
        expect(body).toEqual({
          error: {
            code: "VALIDATION",
            message: expect.any(String),
          },
        });
      }

      it("rejects missing title", async () => {
        const baseTime = Date.now();
        await assertValidationFailure({
          startsAt: new Date(baseTime + 10 * 86400000).toISOString(),
          registrationDeadline: new Date(baseTime + 5 * 86400000).toISOString(),
          capacity: 10,
        });
      });

      it("rejects empty or whitespace-only title", async () => {
        const baseTime = Date.now();
        await assertValidationFailure({
          title: "   ",
          startsAt: new Date(baseTime + 10 * 86400000).toISOString(),
          registrationDeadline: new Date(baseTime + 5 * 86400000).toISOString(),
          capacity: 10,
        });
      });

      it("DEV-S2-01: rejects title exceeding 120 characters (PRD BR-3 alignment)", async () => {
        const baseTime = Date.now();
        await assertValidationFailure({
          title: "A".repeat(121),
          startsAt: new Date(baseTime + 10 * 86400000).toISOString(),
          registrationDeadline: new Date(baseTime + 5 * 86400000).toISOString(),
          capacity: 10,
        });
      });

      it("rejects description exceeding 2000 characters", async () => {
        const baseTime = Date.now();
        await assertValidationFailure({
          title: "Valid Title",
          description: "D".repeat(2001),
          startsAt: new Date(baseTime + 10 * 86400000).toISOString(),
          registrationDeadline: new Date(baseTime + 5 * 86400000).toISOString(),
          capacity: 10,
        });
      });

      it("rejects invalid startsAt datetime string", async () => {
        const baseTime = Date.now();
        await assertValidationFailure({
          title: "Valid Title",
          startsAt: "not-a-valid-datetime",
          registrationDeadline: new Date(baseTime + 5 * 86400000).toISOString(),
          capacity: 10,
        });
      });

      it("rejects startsAt in the past or <= database clock_timestamp()", async () => {
        const pastTime = new Date(Date.now() - 3600000).toISOString();
        const pastDeadline = new Date(Date.now() - 7200000).toISOString();
        await assertValidationFailure({
          title: "Past Event",
          startsAt: pastTime,
          registrationDeadline: pastDeadline,
          capacity: 10,
        });
      });

      it("rejects invalid registrationDeadline datetime string", async () => {
        const baseTime = Date.now();
        await assertValidationFailure({
          title: "Valid Title",
          startsAt: new Date(baseTime + 10 * 86400000).toISOString(),
          registrationDeadline: "invalid-iso-string",
          capacity: 10,
        });
      });

      it("rejects registrationDeadline strictly after startsAt (BR-3)", async () => {
        const baseTime = Date.now();
        const startsAt = new Date(baseTime + 5 * 86400000).toISOString();
        const registrationDeadline = new Date(baseTime + 10 * 86400000).toISOString(); // After startsAt
        await assertValidationFailure({
          title: "Late Deadline Event",
          startsAt,
          registrationDeadline,
          capacity: 10,
        });
      });

      it("rejects capacity < 1 (e.g. 0)", async () => {
        const baseTime = Date.now();
        await assertValidationFailure({
          title: "Zero Capacity Event",
          startsAt: new Date(baseTime + 10 * 86400000).toISOString(),
          registrationDeadline: new Date(baseTime + 5 * 86400000).toISOString(),
          capacity: 0,
        });
      });

      it("rejects capacity > 1000 (e.g. 1001)", async () => {
        const baseTime = Date.now();
        await assertValidationFailure({
          title: "Too Large Capacity Event",
          startsAt: new Date(baseTime + 10 * 86400000).toISOString(),
          registrationDeadline: new Date(baseTime + 5 * 86400000).toISOString(),
          capacity: 1001,
        });
      });

      it("rejects non-integer capacity (e.g. 10.5)", async () => {
        const baseTime = Date.now();
        await assertValidationFailure({
          title: "Float Capacity Event",
          startsAt: new Date(baseTime + 10 * 86400000).toISOString(),
          registrationDeadline: new Date(baseTime + 5 * 86400000).toISOString(),
          capacity: 10.5,
        });
      });
    });
  });

  // --- Suite 2: Event Listing (GET /api/orgs/:orgId/events) ---

  describe("A1: Event Listing (GET /api/orgs/:orgId/events)", () => {
    it("allows member+ role threshold to list events (member, admin, owner)", async () => {
      const cookies = [memberACookie, adminACookie, ownerACookie];
      for (const cookie of cookies) {
        const res = await app.request(`http://localhost/api/orgs/${orgAId}/events`, {
          method: "GET",
          headers: { cookie },
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(Array.isArray(data)).toBe(true);
      }
    });

    it("I1: rejects unauthenticated listing request with 401 UNAUTHENTICATED", async () => {
      const res = await app.request(`http://localhost/api/orgs/${orgAId}/events`, {
        method: "GET",
      });
      expect(res.status).toBe(401);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data).toEqual({
        error: {
          code: "UNAUTHENTICATED",
          message: expect.any(String),
        },
      });
    });

    it("I2: rejects non-member accessing org events with 403 FORBIDDEN", async () => {
      const res = await app.request(`http://localhost/api/orgs/${orgAId}/events`, {
        method: "GET",
        headers: { cookie: ownerBCookie },
      });
      expect(res.status).toBe(403);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data).toEqual({
        error: {
          code: "FORBIDDEN",
          message: expect.any(String),
        },
      });
    });

    it("PRD §7 S3 Contract: returns confirmedCount and waitlistedCount as numbers in S3", async () => {
      const res = await app.request(`http://localhost/api/orgs/${orgAId}/events`, {
        method: "GET",
        headers: { cookie: memberACookie },
      });
      expect(res.status).toBe(200);
      const events = (await res.json()) as Array<Record<string, unknown>>;
      expect(events.length).toBeGreaterThan(0);

      for (const evt of events) {
        expect(evt).toHaveProperty("id");
        expect(evt).toHaveProperty("title");
        expect(evt).toHaveProperty("startsAt");
        expect(evt).toHaveProperty("registrationDeadline");
        expect(evt).toHaveProperty("capacity");
        expect(evt).toHaveProperty("status");
        // Strictly verify counters are present as non-negative numbers in S3
        expect(typeof evt.confirmedCount).toBe("number");
        expect(typeof evt.waitlistedCount).toBe("number");
        expect((evt.confirmedCount as number) >= 0).toBe(true);
        expect((evt.waitlistedCount as number) >= 0).toBe(true);
      }
    });

    it("supports pagination: default limit 20, custom limit and offset", async () => {
      // Create a dedicated org with 25 events to verify pagination
      const ownerC = await app.request("http://localhost/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({
          email: "owner-c@example.com",
          password: "password123456",
          name: "Owner C",
        }),
      });
      const cookieC = `better-auth.session_token=${ownerC.headers.get("set-cookie")!.match(/better-auth\.session_token=([^;]+)/)![1]}`;
      const orgCRes = await app.request("http://localhost/api/auth/organization/create", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          cookie: cookieC,
        },
        body: JSON.stringify({ name: "Org C Pagination", slug: `org-c-pag-${Date.now()}` }),
      });
      const orgCId = ((await orgCRes.json()) as { id: string }).id;

      // Insert 25 events directly to test pagination
      const baseTime = Date.now();
      for (let i = 0; i < 25; i++) {
        const evtId = crypto.randomUUID();
        const startsAt = new Date(baseTime + (i + 1) * 86400000);
        const deadline = new Date(baseTime + i * 86400000);
        await ctx.pool.query(
          `INSERT INTO events (id, organization_id, title, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 10, 'open', (SELECT id FROM "user" WHERE email = 'owner-c@example.com'), NOW(), NOW())`,
          [evtId, orgCId, `Paginated Event ${String(i).padStart(2, "0")}`, startsAt, deadline],
        );
      }

      // 1. Default limit (20)
      const resDefault = await app.request(`http://localhost/api/orgs/${orgCId}/events`, {
        method: "GET",
        headers: { cookie: cookieC },
      });
      expect(resDefault.status).toBe(200);
      const defaultList = (await resDefault.json()) as Array<Record<string, unknown>>;
      expect(defaultList.length).toBe(20);

      // 2. Custom limit=10, offset=5
      const resCustom = await app.request(
        `http://localhost/api/orgs/${orgCId}/events?limit=10&offset=5`,
        {
          method: "GET",
          headers: { cookie: cookieC },
        },
      );
      expect(resCustom.status).toBe(200);
      const customList = (await resCustom.json()) as Array<Record<string, unknown>>;
      expect(customList.length).toBe(10);
      expect(customList[0].title).toBe("Paginated Event 05");

      // 3. Deterministic order: ORDER BY starts_at ASC, id ASC
      for (let i = 0; i < defaultList.length - 1; i++) {
        const currTime = new Date(defaultList[i].startsAt as string).getTime();
        const nextTime = new Date(defaultList[i + 1].startsAt as string).getTime();
        expect(currTime).toBeLessThanOrEqual(nextTime);
      }
    });

    it("breaks ties deterministically using id ASC when startsAt is identical", async () => {
      const baseTime = Date.now();
      const sameStartsAt = new Date(baseTime + 20 * 86400000);
      const deadline = new Date(baseTime + 10 * 86400000);

      // Pre-determined UUIDs where id1 < id2 lexically
      const id1 = "00000000-0000-4000-8000-000000000001";
      const id2 = "ffffffff-ffff-4fff-bfff-ffffffffffff";

      // Insert id2 first in DB, then id1
      await ctx.pool.query(
        `INSERT INTO events (id, organization_id, title, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 10, 'open', $6, NOW(), NOW())`,
        [id2, orgAId, "Tie Event B (Larger ID)", sameStartsAt, deadline, ownerAId],
      );
      await ctx.pool.query(
        `INSERT INTO events (id, organization_id, title, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 10, 'open', $6, NOW(), NOW())`,
        [id1, orgAId, "Tie Event A (Smaller ID)", sameStartsAt, deadline, ownerAId],
      );

      const res = await app.request(`http://localhost/api/orgs/${orgAId}/events?limit=100`, {
        method: "GET",
        headers: { cookie: memberACookie },
      });
      expect(res.status).toBe(200);
      const list = (await res.json()) as Array<{ id: string; startsAt: string }>;
      const tieEvents = list.filter((e) => e.id === id1 || e.id === id2);
      expect(tieEvents.length).toBe(2);
      expect(tieEvents[0].id).toBe(id1);
      expect(tieEvents[1].id).toBe(id2);
    });

    it("rejects invalid query parameters with 400 VALIDATION (limit < 1, limit > 100, offset < 0)", async () => {
      const invalidParams = ["limit=0", "limit=101", "limit=-5", "offset=-1", "limit=abc"];

      for (const query of invalidParams) {
        const res = await app.request(`http://localhost/api/orgs/${orgAId}/events?${query}`, {
          method: "GET",
          headers: { cookie: memberACookie },
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: { code: string; message: string } };
        expect(body).toEqual({
          error: {
            code: "VALIDATION",
            message: expect.any(String),
          },
        });
      }
    });

    it("verifies cross-organization data isolation: Org A user never sees Org B events", async () => {
      // Create event in Org B
      const baseTime = Date.now();
      const bPayload = {
        title: "Confidential Org B Strategy Session",
        startsAt: new Date(baseTime + 10 * 86400000).toISOString(),
        registrationDeadline: new Date(baseTime + 5 * 86400000).toISOString(),
        capacity: 10,
      };

      const resCreateB = await app.request(`http://localhost/api/orgs/${orgBId}/events`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerBCookie },
        body: JSON.stringify(bPayload),
      });
      expect(resCreateB.status).toBe(201);

      // Org A member queries Org A events
      const resListA = await app.request(`http://localhost/api/orgs/${orgAId}/events`, {
        method: "GET",
        headers: { cookie: memberACookie },
      });
      expect(resListA.status).toBe(200);
      const listA = (await resListA.json()) as Array<Record<string, unknown>>;

      // Verify Org B event is not present in Org A
      const foundOrgBEvent = listA.some((e) => e.title === bPayload.title);
      expect(foundOrgBEvent).toBe(false);
    });

    it("returns 500 INTERNAL_ERROR when database fails during event listing, never leaking SQL or credentials", async () => {
      const originalSelect = db.select.bind(db);
      const selectSpy = vi.spyOn(db, "select").mockImplementation((...args) => {
        const fields = args[0] as Record<string, unknown> | undefined;
        if (fields && "startsAt" in fields) {
          // Injects error specifically inside getOrgEvents handler
          throw new Error(
            "Simulated database select failure: SELECT * FROM events; password=secret123 host=10.0.0.1",
          );
        }
        return originalSelect(...args);
      });

      try {
        const res = await app.request(`http://localhost/api/orgs/${orgAId}/events`, {
          method: "GET",
          headers: { cookie: memberACookie },
        });

        expect(res.status).toBe(500);
        const body = (await res.json()) as { error: { code: string; message: string } };
        expect(body).toEqual({
          error: {
            code: "INTERNAL_ERROR",
            message: "Failed to fetch events",
          },
        });
        expect(body.error.message).not.toContain("secret_internal_table");
        expect(body.error.message).not.toContain("password");
        expect(body.error.message).not.toContain("10.0.0.1");
      } finally {
        selectSpy.mockRestore();
      }
    });
  });

  // --- Suite 3: H-Reach Probes ---

  describe("H-Reach Probes (§6.1.5 & §6.1 S2-2)", () => {
    it("proves POST /api/orgs/:orgId/events handler is reached by returning 400 VALIDATION on malformed body", async () => {
      // Valid owner session but empty body
      const res = await app.request(`http://localhost/api/orgs/${orgAId}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ownerACookie,
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("VALIDATION");
    });

    it("proves GET /api/orgs/:orgId/events handler is reached by returning 200 with array structure", async () => {
      const res = await app.request(`http://localhost/api/orgs/${orgAId}/events`, {
        method: "GET",
        headers: { cookie: memberACookie },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it("proves GET /api/orgs/:orgId/members handler is reached by returning 200 with array structure", async () => {
      const res = await app.request(`http://localhost/api/orgs/${orgAId}/members`, {
        method: "GET",
        headers: { cookie: memberACookie },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });
  });

  // --- Suite 4: L5 Foreign Key Behavior Tests ---

  describe("L5 Foreign Key Behavior Tests (DEV-S2-02, DEV-S2-03)", () => {
    it("rejects direct deletion of user who created events with 23503 foreign_key_violation", async () => {
      const client = await ctx.pool.connect();
      try {
        await client.query("BEGIN");
        let caughtDbError: unknown = undefined;
        let deleteSucceeded = false;
        try {
          await client.query(`DELETE FROM "user" WHERE id = $1`, [ownerAId]);
          deleteSucceeded = true;
        } catch (err: unknown) {
          caughtDbError = err;
        } finally {
          await client.query("ROLLBACK");
        }

        expect(
          deleteSucceeded,
          "Direct DELETE FROM user should fail with foreign key violation",
        ).toBe(false);
        expect(caughtDbError).toBeDefined();
        expect(isPostgresDatabaseError(caughtDbError)).toBe(true);
        const pgErr = caughtDbError as PostgresDatabaseError;
        expect(pgErr.code).not.toBe("42P01");
        // In PostgreSQL <=17, RESTRICT raises 23503 (foreign_key_violation).
        // In PostgreSQL >=18 (used in CI), RESTRICT raises 23001 (restrict_violation) per SQL standard.
        expect(["23503", "23001"]).toContain(pgErr.code);
        expect(pgErr.constraint).toBe("events_created_by_user_id_fk");
      } finally {
        client.release();
      }
    });

    it("rejects direct deletion of organization that has events with foreign_key_violation / restrict_violation", async () => {
      const client = await ctx.pool.connect();
      try {
        await client.query("BEGIN");
        let caughtDbError: unknown = undefined;
        let deleteSucceeded = false;
        try {
          await client.query(`DELETE FROM organization WHERE id = $1`, [orgAId]);
          deleteSucceeded = true;
        } catch (err: unknown) {
          caughtDbError = err;
        } finally {
          await client.query("ROLLBACK");
        }

        expect(
          deleteSucceeded,
          "Direct DELETE FROM organization should fail with foreign key violation",
        ).toBe(false);
        expect(caughtDbError).toBeDefined();
        expect(isPostgresDatabaseError(caughtDbError)).toBe(true);
        const pgErr = caughtDbError as PostgresDatabaseError;
        expect(pgErr.code).not.toBe("42P01");
        // In PostgreSQL <=17, RESTRICT raises 23503 (foreign_key_violation).
        // In PostgreSQL >=18 (used in CI), RESTRICT raises 23001 (restrict_violation) per SQL standard.
        expect(["23503", "23001"]).toContain(pgErr.code);
        expect(pgErr.constraint).toBe("events_organization_id_organization_id_fk");
      } finally {
        client.release();
      }
    });
  });
});
