import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { setupTestDatabase, type TestDatabaseContext } from "./test-helper.ts";

let app: typeof import("./index.ts").app;

describe("A1: D4 API Contract Tests (DELETE registrations, PATCH events, POST cancel)", () => {
  let ctx: TestDatabaseContext;
  let ownerCookie: string;
  let adminCookie: string;
  let memberCookie: string;
  let member2Cookie: string;
  let orgId: string;
  let ownerId: string;
  let adminId: string;
  let memberId: string;
  let member2Id: string;

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

    async function addMember(oId: string, uId: string, role: string) {
      await ctx.pool.query(
        'INSERT INTO "member" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, NOW())',
        [`mem_${Date.now()}_${Math.random()}`, oId, uId, role],
      );
    }

    const owner = await createUser("d4-owner@example.com", "D4 Owner");
    const admin = await createUser("d4-admin@example.com", "D4 Admin");
    const member = await createUser("d4-member@example.com", "D4 Member");
    const member2 = await createUser("d4-member2@example.com", "D4 Member 2");

    ownerCookie = owner.cookie;
    adminCookie = admin.cookie;
    memberCookie = member.cookie;
    member2Cookie = member2.cookie;

    ownerId = owner.userId;
    adminId = admin.userId;
    memberId = member.userId;
    member2Id = member2.userId;

    orgId = await createOrg(ownerCookie, "D4 Org", `d4-org-${Date.now()}`);
    await addMember(orgId, adminId, "admin");
    await addMember(orgId, memberId, "member");
    await addMember(orgId, member2Id, "member");
  });

  afterAll(async () => {
    if (ctx) {
      await ctx.cleanup();
    }
  });

  async function createEventFixture(
    params: {
      capacity?: number;
      startsAtOffset?: string;
      deadlineOffset?: string;
      status?: string;
    } = {},
  ): Promise<string> {
    const eventId = crypto.randomUUID();
    const capacity = params.capacity ?? 5;
    const startsAtOffset = params.startsAtOffset ?? "10 days";
    const deadlineOffset = params.deadlineOffset ?? "5 days";
    const status = params.status ?? "open";

    await ctx.pool.query(
      `INSERT INTO events (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
       VALUES ($1, $2, 'D4 Event', 'D4 Description', NOW() + interval '${startsAtOffset}', NOW() + interval '${deadlineOffset}', $3, $4, $5, NOW(), NOW())`,
      [eventId, orgId, capacity, status, ownerId],
    );
    return eventId;
  }

  // --- Suite 1: DELETE .../registrations/me ---
  describe("A1: DELETE /api/orgs/:orgId/events/:eventId/registrations/me", () => {
    it("returns 204 when cancelling own registration", async () => {
      const eventId = await createEventFixture();
      // Register first
      await app.request(`http://localhost/api/orgs/${orgId}/events/${eventId}/registrations`, {
        method: "POST",
        headers: { cookie: memberCookie },
      });

      const res = await app.request(
        `http://localhost/api/orgs/${orgId}/events/${eventId}/registrations/me`,
        {
          method: "DELETE",
          headers: { cookie: memberCookie },
        },
      );
      expect(res.status).toBe(204);
    });

    it("returns 204 when no active registration exists (noop)", async () => {
      const eventId = await createEventFixture();
      const res = await app.request(
        `http://localhost/api/orgs/${orgId}/events/${eventId}/registrations/me`,
        {
          method: "DELETE",
          headers: { cookie: member2Cookie },
        },
      );
      expect(res.status).toBe(204);
    });

    it("returns 409 EVENT_STARTED when event is already started", async () => {
      const eventId = await createEventFixture({
        startsAtOffset: "-1 hour",
        deadlineOffset: "-2 hours",
      });

      const res = await app.request(
        `http://localhost/api/orgs/${orgId}/events/${eventId}/registrations/me`,
        {
          method: "DELETE",
          headers: { cookie: memberCookie },
        },
      );
      expect(res.status).toBe(409);
      const json = (await res.json()) as { error: { code: string; message: string } };
      expect(json.error.code).toBe("EVENT_STARTED");
    });
  });

  // --- Suite 2: DELETE .../registrations/:registrationId (admin) ---
  describe("A1: DELETE /api/orgs/:orgId/events/:eventId/registrations/:registrationId", () => {
    it("returns 204 and promotes waitlisted on first cancellation of confirmed registration", async () => {
      const eventId = await createEventFixture({ capacity: 1 });
      // member registers -> confirmed
      const reg1Res = await app.request(
        `http://localhost/api/orgs/${orgId}/events/${eventId}/registrations`,
        { method: "POST", headers: { cookie: memberCookie } },
      );
      expect(reg1Res.status).toBe(201);
      const reg1 = (await reg1Res.json()) as { id: string };

      // member2 registers -> waitlisted
      const reg2Res = await app.request(
        `http://localhost/api/orgs/${orgId}/events/${eventId}/registrations`,
        {
          method: "POST",
          headers: { cookie: member2Cookie },
        },
      );
      expect(reg2Res.status).toBe(201);

      const deleteRes = await app.request(
        `http://localhost/api/orgs/${orgId}/events/${eventId}/registrations/${reg1.id}`,
        {
          method: "DELETE",
          headers: { cookie: adminCookie },
        },
      );
      expect(deleteRes.status).toBe(204);

      // Verify member2 is now confirmed
      const m2Reg = await ctx.pool.query<{ status: string }>(
        `SELECT status FROM registrations WHERE event_id = $1 AND user_id = $2`,
        [eventId, member2Id],
      );
      expect(m2Reg.rows[0].status).toBe("confirmed");
    });

    it("returns 204 and leaves all columns unchanged on duplicate cancel", async () => {
      const eventId = await createEventFixture({ capacity: 2 });
      const regRes = await app.request(
        `http://localhost/api/orgs/${orgId}/events/${eventId}/registrations`,
        { method: "POST", headers: { cookie: memberCookie } },
      );
      expect(regRes.status).toBe(201);
      const reg = (await regRes.json()) as { id: string };

      // First cancel
      const del1Res = await app.request(
        `http://localhost/api/orgs/${orgId}/events/${eventId}/registrations/${reg.id}`,
        { method: "DELETE", headers: { cookie: adminCookie } },
      );
      expect(del1Res.status).toBe(204);

      const snap1 = await ctx.pool.query(`SELECT * FROM registrations WHERE id = $1`, [reg.id]);

      // Duplicate cancel
      const res2 = await app.request(
        `http://localhost/api/orgs/${orgId}/events/${eventId}/registrations/${reg.id}`,
        { method: "DELETE", headers: { cookie: adminCookie } },
      );
      expect(res2.status).toBe(204);

      const snap2 = await ctx.pool.query(`SELECT * FROM registrations WHERE id = $1`, [reg.id]);
      expect(snap2.rows).toEqual(snap1.rows);
    });

    it("returns 404 NOT_FOUND for wrong eventId and registrationId combination, DB unchanged", async () => {
      const eventId1 = await createEventFixture();
      const eventId2 = await createEventFixture();

      const regRes = await app.request(
        `http://localhost/api/orgs/${orgId}/events/${eventId1}/registrations`,
        { method: "POST", headers: { cookie: memberCookie } },
      );
      expect(regRes.status).toBe(201);
      const reg1 = (await regRes.json()) as { id: string };

      const regSnapBefore = await ctx.pool.query(`SELECT * FROM registrations WHERE id = $1`, [
        reg1.id,
      ]);

      // Call eventId2 with reg1.id
      const res = await app.request(
        `http://localhost/api/orgs/${orgId}/events/${eventId2}/registrations/${reg1.id}`,
        { method: "DELETE", headers: { cookie: adminCookie } },
      );
      expect(res.status).toBe(404);
      const json = (await res.json()) as { error: { code: string; message: string } };
      expect(json.error.code).toBe("NOT_FOUND");

      const regSnapAfter = await ctx.pool.query(`SELECT * FROM registrations WHERE id = $1`, [
        reg1.id,
      ]);
      expect(regSnapAfter.rows).toEqual(regSnapBefore.rows);
    });
  });

  // --- Suite 3: PATCH /api/orgs/:orgId/events/:eventId ---
  describe("A1: PATCH /api/orgs/:orgId/events/:eventId", () => {
    it("returns 200 with eventResponseSchema DTO on successful update", async () => {
      const eventId = await createEventFixture();
      const res = await app.request(`http://localhost/api/orgs/${orgId}/events/${eventId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        body: JSON.stringify({
          title: "Updated Title",
          description: "Updated Description",
          capacity: 20,
        }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.id).toBe(eventId);
      expect(data.organizationId).toBe(orgId);
      expect(data.title).toBe("Updated Title");
      expect(data.description).toBe("Updated Description");
      expect(data.capacity).toBe(20);
      expect(data.status).toBe("open");
      expect(data).toHaveProperty("startsAt");
      expect(data).toHaveProperty("registrationDeadline");
      expect(data).toHaveProperty("createdAt");
      expect(data).toHaveProperty("updatedAt");
      expect(data).not.toHaveProperty("confirmedCount");
      expect(data).not.toHaveProperty("waitlistedCount");
    });

    it("returns 409 EVENT_STARTED when event is started and body contains capacity", async () => {
      const eventId = await createEventFixture({
        capacity: 10,
        startsAtOffset: "-1 hour",
        deadlineOffset: "-2 hours",
      });

      const res = await app.request(`http://localhost/api/orgs/${orgId}/events/${eventId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        body: JSON.stringify({ capacity: 10 }), // even if value is identical
      });
      expect(res.status).toBe(409);
      const json = (await res.json()) as { error: { code: string; message: string } };
      expect(json.error.code).toBe("EVENT_STARTED");
    });

    it("returns 200 when event is started and body only updates title", async () => {
      const eventId = await createEventFixture({
        startsAtOffset: "-1 hour",
        deadlineOffset: "-2 hours",
      });

      const res = await app.request(`http://localhost/api/orgs/${orgId}/events/${eventId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        body: JSON.stringify({ title: "New Title Only" }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { title: string };
      expect(data.title).toBe("New Title Only");
    });

    it("returns 409 EVENT_CANCELLED when updating a cancelled event", async () => {
      const eventId = await createEventFixture({ status: "cancelled" });

      const res = await app.request(`http://localhost/api/orgs/${orgId}/events/${eventId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        body: JSON.stringify({ title: "Try to edit cancelled" }),
      });
      expect(res.status).toBe(409);
      const json = (await res.json()) as { error: { code: string; message: string } };
      expect(json.error.code).toBe("EVENT_CANCELLED");
    });

    it("returns 409 CAPACITY_BELOW_CONFIRMED when setting capacity below confirmed count", async () => {
      const eventId = await createEventFixture({ capacity: 2 });
      const reg1Res = await app.request(
        `http://localhost/api/orgs/${orgId}/events/${eventId}/registrations`,
        {
          method: "POST",
          headers: { cookie: memberCookie },
        },
      );
      expect(reg1Res.status).toBe(201);

      const reg2Res = await app.request(
        `http://localhost/api/orgs/${orgId}/events/${eventId}/registrations`,
        {
          method: "POST",
          headers: { cookie: member2Cookie },
        },
      );
      expect(reg2Res.status).toBe(201);

      const res = await app.request(`http://localhost/api/orgs/${orgId}/events/${eventId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        body: JSON.stringify({ capacity: 1 }),
      });
      expect(res.status).toBe(409);
      const json = (await res.json()) as { error: { code: string; message: string } };
      expect(json.error.code).toBe("CAPACITY_BELOW_CONFIRMED");
    });

    it("rejects empty body, unknown fields, or capacity out of range with 400 VALIDATION", async () => {
      const eventId = await createEventFixture();

      // Empty body
      const resEmpty = await app.request(`http://localhost/api/orgs/${orgId}/events/${eventId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: adminCookie },
        body: JSON.stringify({}),
      });
      expect(resEmpty.status).toBe(400);
      const jsonEmpty = (await resEmpty.json()) as { error: { code: string; message: string } };
      expect(jsonEmpty.error.code).toBe("VALIDATION");

      // Unknown fields (.strict())
      const resUnknown = await app.request(`http://localhost/api/orgs/${orgId}/events/${eventId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: adminCookie },
        body: JSON.stringify({ startsAt: "2026-12-01T00:00:00Z" }),
      });
      expect(resUnknown.status).toBe(400);
      const jsonUnknown = (await resUnknown.json()) as { error: { code: string; message: string } };
      expect(jsonUnknown.error.code).toBe("VALIDATION");

      // Capacity out of range (0 or > 1000)
      const resZero = await app.request(`http://localhost/api/orgs/${orgId}/events/${eventId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: adminCookie },
        body: JSON.stringify({ capacity: 0 }),
      });
      expect(resZero.status).toBe(400);
      const jsonZero = (await resZero.json()) as { error: { code: string; message: string } };
      expect(jsonZero.error.code).toBe("VALIDATION");
    });
  });

  // --- Suite 4: POST /api/orgs/:orgId/events/:eventId/cancel ---
  describe("A1: POST /api/orgs/:orgId/events/:eventId/cancel", () => {
    it("returns 200 with DTO and status='cancelled', registrations unchanged", async () => {
      const eventId = await createEventFixture({ capacity: 5 });
      const regRes = await app.request(
        `http://localhost/api/orgs/${orgId}/events/${eventId}/registrations`,
        {
          method: "POST",
          headers: { cookie: memberCookie },
        },
      );
      expect(regRes.status).toBe(201);

      const regsBefore = await ctx.pool.query(
        `SELECT * FROM registrations WHERE event_id = $1 ORDER BY id`,
        [eventId],
      );

      const res = await app.request(`http://localhost/api/orgs/${orgId}/events/${eventId}/cancel`, {
        method: "POST",
        headers: { cookie: adminCookie },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { id: string; status: string };
      expect(data.id).toBe(eventId);
      expect(data.status).toBe("cancelled");

      const regsAfter = await ctx.pool.query(
        `SELECT * FROM registrations WHERE event_id = $1 ORDER BY id`,
        [eventId],
      );
      expect(regsAfter.rows).toEqual(regsBefore.rows);
    });

    it("returns 409 EVENT_CANCELLED on duplicate cancel of event", async () => {
      const eventId = await createEventFixture({ status: "cancelled" });

      const res = await app.request(`http://localhost/api/orgs/${orgId}/events/${eventId}/cancel`, {
        method: "POST",
        headers: { cookie: adminCookie },
      });
      expect(res.status).toBe(409);
      const json = (await res.json()) as { error: { code: string; message: string } };
      expect(json.error.code).toBe("EVENT_CANCELLED");
    });

    it("returns 409 EVENT_STARTED when cancelling a started event, DB unchanged", async () => {
      const eventId = await createEventFixture({
        startsAtOffset: "-1 hour",
        deadlineOffset: "-2 hours",
      });

      const snapBefore = await ctx.pool.query(`SELECT * FROM events WHERE id = $1`, [eventId]);

      const res = await app.request(`http://localhost/api/orgs/${orgId}/events/${eventId}/cancel`, {
        method: "POST",
        headers: { cookie: adminCookie },
      });
      expect(res.status).toBe(409);
      const json = (await res.json()) as { error: { code: string; message: string } };
      expect(json.error.code).toBe("EVENT_STARTED");

      const snapAfter = await ctx.pool.query(`SELECT * FROM events WHERE id = $1`, [eventId]);
      expect(snapAfter.rows).toEqual(snapBefore.rows);
    });
  });

  // --- Suite 5: Invalid UUID path parameters (admin call) ---
  describe("A1: Path parameter invalid UUID handling", () => {
    const invalidCases: Array<{
      name: string;
      method: string;
      getPath: (validEventId: string) => string;
      headers?: Record<string, string>;
      body?: string;
    }> = [
      {
        name: "DELETE .../events/:eventId/registrations/me with invalid eventId",
        method: "DELETE",
        getPath: () =>
          `http://localhost/api/orgs/${orgId}/events/not-a-valid-uuid/registrations/me`,
      },
      {
        name: "DELETE .../events/:eventId/registrations/:registrationId with invalid eventId",
        method: "DELETE",
        getPath: () =>
          `http://localhost/api/orgs/${orgId}/events/not-a-valid-uuid/registrations/${crypto.randomUUID()}`,
      },
      {
        name: "DELETE .../events/:eventId/registrations/:registrationId with invalid registrationId",
        method: "DELETE",
        getPath: (validEventId) =>
          `http://localhost/api/orgs/${orgId}/events/${validEventId}/registrations/not-a-valid-uuid`,
      },
      {
        name: "PATCH .../events/:eventId with invalid eventId",
        method: "PATCH",
        getPath: () => `http://localhost/api/orgs/${orgId}/events/not-a-valid-uuid`,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Valid Title" }),
      },
      {
        name: "POST .../events/:eventId/cancel with invalid eventId",
        method: "POST",
        getPath: () => `http://localhost/api/orgs/${orgId}/events/not-a-valid-uuid/cancel`,
      },
    ];

    it.each(invalidCases)(
      "returns 400 VALIDATION (not 500 PG 22P02) for $name",
      async ({ method, getPath, headers, body }) => {
        const validEventId = await createEventFixture();
        const path = getPath(validEventId);
        const res = await app.request(path, {
          method,
          headers: {
            cookie: adminCookie,
            ...headers,
          },
          ...(body ? { body } : {}),
        });
        expect(res.status).toBe(400);
        const json = (await res.json()) as { error: { code: string; message: string } };
        expect(json.error.code).toBe("VALIDATION");
      },
    );
  });
});
