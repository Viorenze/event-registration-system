import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { setupTestDatabase, type TestDatabaseContext } from "./test-helper.ts";

let app: typeof import("./index.ts").app;
let db: typeof import("./auth.ts").db;

describe("S5-1 Event Read Endpoints Integration Tests (Detail & Registrations List)", () => {
  let ctx: TestDatabaseContext;
  let ownerACookie: string;
  let adminACookie: string;
  let memberACookie: string;
  let memberA2Cookie: string;
  let ownerBCookie: string;

  let adminAId: string;
  let memberAId: string;
  let memberA2Id: string;

  let memberAEmail: string;
  let memberA2Email: string;

  let orgAId: string;
  let orgBId: string;

  async function getDbSnapshot() {
    const [orgs, invitations, members, eventsTable, regs] = await Promise.all([
      ctx.pool.query('SELECT * FROM "organization" ORDER BY id'),
      ctx.pool.query('SELECT * FROM "invitation" ORDER BY id'),
      ctx.pool.query('SELECT * FROM "member" ORDER BY id'),
      ctx.pool.query('SELECT * FROM "events" ORDER BY id'),
      ctx.pool.query('SELECT * FROM "registrations" ORDER BY id'),
    ]);
    return {
      organizations: orgs.rows,
      invitations: invitations.rows,
      members: members.rows,
      events: eventsTable.rows,
      registrations: regs.rows,
    };
  }

  async function createUser(
    email: string,
    name: string,
  ): Promise<{ cookie: string; userId: string; email: string }> {
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
    return { cookie, userId: sessionData.user.id, email };
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

  async function createEvent(
    cookie: string,
    orgId: string,
    payload: {
      title: string;
      description?: string | null;
      capacity: number;
      startsAt?: string;
      registrationDeadline?: string;
    },
  ) {
    const res = await app.request(`http://localhost/api/orgs/${orgId}/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        title: payload.title,
        description: payload.description,
        capacity: payload.capacity,
        startsAt: payload.startsAt ?? new Date(Date.now() + 86400000 * 5).toISOString(),
        registrationDeadline:
          payload.registrationDeadline ?? new Date(Date.now() + 86400000 * 2).toISOString(),
      }),
    });
    if (!res.ok) {
      throw new Error(`Failed to create event: HTTP ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as { id: string; [key: string]: unknown };
  }

  beforeAll(async () => {
    ctx = await setupTestDatabase();
    process.env.DATABASE_URL = ctx.testDbUrl;

    const mod = await import("./index.ts");
    app = mod.app;
    const authMod = await import("./auth.ts");
    db = authMod.db;

    const ownerA = await createUser("reads-owner-a@example.com", "Reads Owner A");
    const adminA = await createUser("reads-admin-a@example.com", "Reads Admin A");
    const memberA = await createUser("reads-member-a@example.com", "Reads Member A");
    const memberA2 = await createUser("reads-member-a2@example.com", "Reads Member A2");
    const ownerB = await createUser("reads-owner-b@example.com", "Reads Owner B");

    ownerACookie = ownerA.cookie;
    adminACookie = adminA.cookie;
    memberACookie = memberA.cookie;
    memberA2Cookie = memberA2.cookie;
    ownerBCookie = ownerB.cookie;

    adminAId = adminA.userId;
    memberAId = memberA.userId;
    memberA2Id = memberA2.userId;

    memberAEmail = memberA.email;
    memberA2Email = memberA2.email;

    orgAId = await createOrg(ownerACookie, "Reads Org A", `reads-org-a-${Date.now()}`);
    orgBId = await createOrg(ownerBCookie, "Reads Org B", `reads-org-b-${Date.now()}`);

    await addMember(orgAId, adminAId, "admin");
    await addMember(orgAId, memberAId, "member");
    await addMember(orgAId, memberA2Id, "member");
  });

  afterAll(async () => {
    if (ctx) {
      await ctx.cleanup();
    }
  });

  describe("Event Detail: GET /api/orgs/:orgId/events/:eventId", () => {
    it("D-1 成员读取：200，字段齐全，计数是数字，没有报名时 myRegistration 为 null", async () => {
      const event = await createEvent(adminACookie, orgAId, {
        title: "D-1 Detail Initial Event",
        description: "Initial description",
        capacity: 10,
      });

      const res = await app.request(`http://localhost/api/orgs/${orgAId}/events/${event.id}`, {
        method: "GET",
        headers: { cookie: memberACookie },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;

      expect(data.id).toBe(event.id);
      expect(data.organizationId).toBe(orgAId);
      expect(data.title).toBe("D-1 Detail Initial Event");
      expect(data.description).toBe("Initial description");
      expect(typeof data.startsAt).toBe("string");
      expect(typeof data.registrationDeadline).toBe("string");
      expect(data.capacity).toBe(10);
      expect(data.status).toBe("open");
      expect(data.createdBy).toBe(adminAId);
      expect(typeof data.createdAt).toBe("string");
      expect(typeof data.updatedAt).toBe("string");
      expect(data.confirmedCount).toBe(0);
      expect(data.waitlistedCount).toBe(0);
      expect(data.myRegistration).toBeNull();
    });

    it("D-2 我报名后：myRegistration.id 等于数据库里的报名 id，状态正确（confirmed 和 waitlisted 各一例），计数随之变化", async () => {
      const event = await createEvent(adminACookie, orgAId, {
        title: "D-2 Capacity 1 Event",
        capacity: 1,
      });

      // Member A registers -> confirmed
      const regRes1 = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${event.id}/registrations`,
        {
          method: "POST",
          headers: { cookie: memberACookie },
        },
      );
      expect(regRes1.status).toBe(201);
      const regData1 = (await regRes1.json()) as { id: string; status: string };
      expect(regData1.status).toBe("confirmed");

      // Verify DB row
      const dbReg1 = await ctx.pool.query(
        'SELECT id, status FROM "registrations" WHERE event_id = $1 AND user_id = $2',
        [event.id, memberAId],
      );
      expect(dbReg1.rows[0].id).toBe(regData1.id);
      expect(dbReg1.rows[0].status).toBe("confirmed");

      // Member A reads detail
      const resDetailA = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${event.id}`,
        {
          method: "GET",
          headers: { cookie: memberACookie },
        },
      );
      expect(resDetailA.status).toBe(200);
      const detailA = (await resDetailA.json()) as Record<string, unknown>;
      expect(detailA.confirmedCount).toBe(1);
      expect(detailA.waitlistedCount).toBe(0);
      expect(detailA.myRegistration).toEqual({
        id: regData1.id,
        status: "confirmed",
      });

      // Member A2 registers -> waitlisted
      const regRes2 = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${event.id}/registrations`,
        {
          method: "POST",
          headers: { cookie: memberA2Cookie },
        },
      );
      expect(regRes2.status).toBe(201);
      const regData2 = (await regRes2.json()) as { id: string; status: string };
      expect(regData2.status).toBe("waitlisted");

      // Member A2 reads detail
      const resDetailA2 = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${event.id}`,
        {
          method: "GET",
          headers: { cookie: memberA2Cookie },
        },
      );
      expect(resDetailA2.status).toBe(200);
      const detailA2 = (await resDetailA2.json()) as Record<string, unknown>;
      expect(detailA2.confirmedCount).toBe(1);
      expect(detailA2.waitlistedCount).toBe(1);
      expect(detailA2.myRegistration).toEqual({
        id: regData2.id,
        status: "waitlisted",
      });
    });

    it("D-3 我取消后：myRegistration 为 null，计数不含已取消", async () => {
      const event = await createEvent(adminACookie, orgAId, {
        title: "D-3 Cancellation Event",
        capacity: 1,
      });

      // Member A registers (confirmed)
      await app.request(`http://localhost/api/orgs/${orgAId}/events/${event.id}/registrations`, {
        method: "POST",
        headers: { cookie: memberACookie },
      });

      // Member A2 registers (waitlisted)
      await app.request(`http://localhost/api/orgs/${orgAId}/events/${event.id}/registrations`, {
        method: "POST",
        headers: { cookie: memberA2Cookie },
      });

      // Member A cancels registration
      const cancelRes = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${event.id}/registrations/me`,
        {
          method: "DELETE",
          headers: { cookie: memberACookie },
        },
      );
      expect(cancelRes.status).toBe(204);

      // Member A reads detail: myRegistration is null, confirmedCount is 1 (A2 promoted), waitlistedCount is 0
      const detailResA = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${event.id}`,
        {
          method: "GET",
          headers: { cookie: memberACookie },
        },
      );
      expect(detailResA.status).toBe(200);
      const detailA = (await detailResA.json()) as Record<string, unknown>;
      expect(detailA.myRegistration).toBeNull();
      expect(detailA.confirmedCount).toBe(1);
      expect(detailA.waitlistedCount).toBe(0);
    });

    it("D-4 用户 B 报名，用户 A 读取：A 的 myRegistration 仍为 null", async () => {
      const event = await createEvent(adminACookie, orgAId, {
        title: "D-4 Other User Registered",
        capacity: 5,
      });

      // Member A2 registers
      await app.request(`http://localhost/api/orgs/${orgAId}/events/${event.id}/registrations`, {
        method: "POST",
        headers: { cookie: memberA2Cookie },
      });

      // Member A (unregistered) reads detail
      const resA = await app.request(`http://localhost/api/orgs/${orgAId}/events/${event.id}`, {
        method: "GET",
        headers: { cookie: memberACookie },
      });
      expect(resA.status).toBe(200);
      const detailA = (await resA.json()) as Record<string, unknown>;
      expect(detailA.confirmedCount).toBe(1);
      expect(detailA.waitlistedCount).toBe(0);
      expect(detailA.myRegistration).toBeNull();
    });

    it("D-5 跨组织：A 组织 admin 在 /orgs/<A>/ 下用 B 组织的 eventId，404 NOT_FOUND。非成员 403。未登录 401。非法 UUID：成员 400 VALIDATION，非成员 403", async () => {
      const eventB = await createEvent(ownerBCookie, orgBId, {
        title: "Event in Org B",
        capacity: 10,
      });

      const eventA = await createEvent(adminACookie, orgAId, {
        title: "Event in Org A",
        capacity: 10,
      });

      // Org A admin accessing /orgs/A/events/eventBId -> 404
      const resCross = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${eventB.id}`,
        {
          method: "GET",
          headers: { cookie: adminACookie },
        },
      );
      expect(resCross.status).toBe(404);
      expect(((await resCross.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");

      // Non-member accessing /orgs/A/events/eventAId -> 403
      const resNonMember = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${eventA.id}`,
        {
          method: "GET",
          headers: { cookie: ownerBCookie },
        },
      );
      expect(resNonMember.status).toBe(403);
      expect(((await resNonMember.json()) as { error: { code: string } }).error.code).toBe(
        "FORBIDDEN",
      );

      // Unauthenticated -> 401
      const resUnauth = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${eventA.id}`,
        {
          method: "GET",
        },
      );
      expect(resUnauth.status).toBe(401);
      expect(((await resUnauth.json()) as { error: { code: string } }).error.code).toBe(
        "UNAUTHENTICATED",
      );

      // Member with invalid UUID -> 400 VALIDATION
      const resInvalidUuidMember = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/not-a-valid-uuid`,
        {
          method: "GET",
          headers: { cookie: memberACookie },
        },
      );
      expect(resInvalidUuidMember.status).toBe(400);
      expect(((await resInvalidUuidMember.json()) as { error: { code: string } }).error.code).toBe(
        "VALIDATION",
      );

      // Non-member with invalid UUID -> 403 FORBIDDEN
      const resInvalidUuidNonMember = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/not-a-valid-uuid`,
        {
          method: "GET",
          headers: { cookie: ownerBCookie },
        },
      );
      expect(resInvalidUuidNonMember.status).toBe(403);
      expect(
        ((await resInvalidUuidNonMember.json()) as { error: { code: string } }).error.code,
      ).toBe("FORBIDDEN");
    });

    it("D-6 已取消的活动：200，status 为 cancelled", async () => {
      const event = await createEvent(adminACookie, orgAId, {
        title: "D-6 Cancelled Event Test",
        capacity: 10,
      });

      // Member A registers before event is cancelled
      const regRes = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${event.id}/registrations`,
        {
          method: "POST",
          headers: { cookie: memberACookie },
        },
      );
      expect(regRes.status).toBe(201);
      const regData = (await regRes.json()) as { id: string };

      const cancelRes = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${event.id}/cancel`,
        {
          method: "POST",
          headers: { cookie: adminACookie },
        },
      );
      expect(cancelRes.status).toBe(200);

      const res = await app.request(`http://localhost/api/orgs/${orgAId}/events/${event.id}`, {
        method: "GET",
        headers: { cookie: memberACookie },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.id).toBe(event.id);
      expect(data.status).toBe("cancelled");
      expect(data.confirmedCount).toBe(1);
      expect(data.myRegistration).toEqual({
        id: regData.id,
        status: "confirmed",
      });
    });

    it("D-7 500 映射：用 vi.spyOn 注入底层异常，断言 500 INTERNAL_ERROR，且响应不含 SQL 或内部细节", async () => {
      const event = await createEvent(adminACookie, orgAId, {
        title: "D-7 Spy Error Event",
        capacity: 10,
      });

      const originalSelect = db.select.bind(db);

      // 1. 基线测量：发正常请求，用 vi.spyOn(db, "select") 只计数不拦截（透传原实现），得到认证和中间件阶段会调用 db.select 的次数 K
      let K = 0;
      let firstHandlerEncountered = false;
      const baselineSpy = vi.spyOn(db, "select").mockImplementation((...args) => {
        const stack = new Error().stack ?? "";
        const isHandler = stack.includes("event-reads.ts");
        if (!isHandler && !firstHandlerEncountered) {
          K++;
        } else {
          firstHandlerEncountered = true;
        }
        return originalSelect(...args);
      });

      try {
        const baselineRes = await app.request(
          `http://localhost/api/orgs/${orgAId}/events/${event.id}`,
          {
            method: "GET",
            headers: { cookie: memberACookie },
          },
        );
        expect(baselineRes.status).toBe(200);
      } finally {
        baselineSpy.mockRestore();
      }

      console.log("Measured K for D-7 (GET event detail):", K);
      expect(K).toBeGreaterThan(0);

      // 2. 正式用例：对前 K 次 db.select 透传原实现，从第 K+1 次起抛出异常
      let formalCallCount = 0;
      const errorSpy = vi.spyOn(db, "select").mockImplementation((...args) => {
        formalCallCount++;
        if (formalCallCount <= K) {
          return originalSelect(...args);
        }
        throw new Error(
          "Simulated database select failure: SELECT * FROM registrations; password=secret123 host=10.0.0.1",
        );
      });

      try {
        const res = await app.request(`http://localhost/api/orgs/${orgAId}/events/${event.id}`, {
          method: "GET",
          headers: { cookie: memberACookie },
        });

        expect(res.status).toBe(500);
        const body = (await res.json()) as { error: { code: string; message: string } };
        expect(body).toEqual({
          error: {
            code: "INTERNAL_ERROR",
            message: "Failed to fetch event detail",
          },
        });
        expect(body.error.message).not.toContain("password");
        expect(body.error.message).not.toContain("10.0.0.1");
        expect(body.error.message).not.toContain("SELECT");
        expect(body.error.message).not.toContain("registrations");
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  describe("Event Registrations List: GET /api/orgs/:orgId/events/:eventId/registrations", () => {
    it("R-1 admin 和 owner 返回 200；member 返回 403。只含有效报名，不含已取消。顺序与数据库里 seq 升序一致", async () => {
      const event = await createEvent(adminACookie, orgAId, {
        title: "R-1 Registrations List Ordering",
        capacity: 1,
      });

      // Member A registers (confirmed, seq 1)
      await app.request(`http://localhost/api/orgs/${orgAId}/events/${event.id}/registrations`, {
        method: "POST",
        headers: { cookie: memberACookie },
      });

      // Member A2 registers (waitlisted, seq 2)
      await app.request(`http://localhost/api/orgs/${orgAId}/events/${event.id}/registrations`, {
        method: "POST",
        headers: { cookie: memberA2Cookie },
      });

      // Member A cancels (status -> cancelled, Member A2 promoted to confirmed)
      await app.request(`http://localhost/api/orgs/${orgAId}/events/${event.id}/registrations/me`, {
        method: "DELETE",
        headers: { cookie: memberACookie },
      });

      // Member A re-registers (waitlisted, seq 3)
      await app.request(`http://localhost/api/orgs/${orgAId}/events/${event.id}/registrations`, {
        method: "POST",
        headers: { cookie: memberACookie },
      });

      // Member A calls -> 403
      const resMember = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${event.id}/registrations`,
        {
          method: "GET",
          headers: { cookie: memberACookie },
        },
      );
      expect(resMember.status).toBe(403);

      // Admin calls -> 200
      const resAdmin = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${event.id}/registrations`,
        {
          method: "GET",
          headers: { cookie: adminACookie },
        },
      );
      expect(resAdmin.status).toBe(200);
      const adminList = (await resAdmin.json()) as Array<{
        id: string;
        userId: string;
        name: string;
        status: string;
        createdAt: string;
      }>;

      // Owner calls -> 200
      const resOwner = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${event.id}/registrations`,
        {
          method: "GET",
          headers: { cookie: ownerACookie },
        },
      );
      expect(resOwner.status).toBe(200);

      // Query database directly to check seq ascending order and active status
      const dbRows = await ctx.pool.query(
        `SELECT id, user_id, status, seq FROM registrations 
         WHERE event_id = $1 AND organization_id = $2 AND status IN ('confirmed', 'waitlisted')
         ORDER BY seq ASC`,
        [event.id, orgAId],
      );

      expect(adminList.length).toBe(2);
      expect(adminList.length).toBe(dbRows.rows.length);
      expect(adminList[0].userId).toBe(memberA2Id);
      expect(adminList[0].status).toBe("confirmed");
      expect(adminList[1].userId).toBe(memberAId);
      expect(adminList[1].status).toBe("waitlisted");

      for (let i = 0; i < adminList.length; i++) {
        expect(adminList[i].id).toBe(dbRows.rows[i].id);
        expect(adminList[i].userId).toBe(dbRows.rows[i].user_id);
        expect(adminList[i].status).toBe(dbRows.rows[i].status);
      }
    });

    it("R-2 每项的键集合恰好是 id、userId、name、status、createdAt，不多不少。整个响应 JSON 文本里不含该用户的 email 字符串", async () => {
      const event = await createEvent(adminACookie, orgAId, {
        title: "R-2 Schema Strict Keys Event",
        capacity: 5,
      });

      await app.request(`http://localhost/api/orgs/${orgAId}/events/${event.id}/registrations`, {
        method: "POST",
        headers: { cookie: memberACookie },
      });
      await app.request(`http://localhost/api/orgs/${orgAId}/events/${event.id}/registrations`, {
        method: "POST",
        headers: { cookie: memberA2Cookie },
      });

      const res = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${event.id}/registrations`,
        {
          method: "GET",
          headers: { cookie: adminACookie },
        },
      );
      expect(res.status).toBe(200);

      const rawJsonText = await res.text();
      expect(rawJsonText).not.toContain(memberAEmail);
      expect(rawJsonText).not.toContain(memberA2Email);

      const list = JSON.parse(rawJsonText) as Array<Record<string, unknown>>;
      expect(list.length).toBe(2);

      const expectedKeys = ["createdAt", "id", "name", "status", "userId"];
      for (const item of list) {
        const itemKeys = Object.keys(item).sort();
        expect(itemKeys).toEqual(expectedKeys);
      }
    });

    it("R-3 用户取消后重新报名：只出现一次，且排在队尾", async () => {
      const event = await createEvent(adminACookie, orgAId, {
        title: "R-3 Re-registration Order Event",
        capacity: 5,
      });

      // Member A registers first
      await app.request(`http://localhost/api/orgs/${orgAId}/events/${event.id}/registrations`, {
        method: "POST",
        headers: { cookie: memberACookie },
      });

      // Member A2 registers second
      await app.request(`http://localhost/api/orgs/${orgAId}/events/${event.id}/registrations`, {
        method: "POST",
        headers: { cookie: memberA2Cookie },
      });

      // Member A cancels
      await app.request(`http://localhost/api/orgs/${orgAId}/events/${event.id}/registrations/me`, {
        method: "DELETE",
        headers: { cookie: memberACookie },
      });

      // Member A registers again
      await app.request(`http://localhost/api/orgs/${orgAId}/events/${event.id}/registrations`, {
        method: "POST",
        headers: { cookie: memberACookie },
      });

      const res = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${event.id}/registrations`,
        {
          method: "GET",
          headers: { cookie: adminACookie },
        },
      );
      expect(res.status).toBe(200);
      const list = (await res.json()) as Array<{ userId: string }>;

      // Member A appears exactly once
      const memberAOccurrences = list.filter((r) => r.userId === memberAId);
      expect(memberAOccurrences.length).toBe(1);

      // Member A is at the end of the list
      expect(list[list.length - 1].userId).toBe(memberAId);
      // Member A2 is first
      expect(list[0].userId).toBe(memberA2Id);
    });

    it("R-4 跨组织 eventId 404，非成员 403，未登录 401，非法 UUID（admin 调用）400", async () => {
      const eventB = await createEvent(ownerBCookie, orgBId, {
        title: "Event in Org B",
        capacity: 10,
      });

      const eventA = await createEvent(adminACookie, orgAId, {
        title: "Event in Org A",
        capacity: 10,
      });

      // Cross org eventId -> 404 NOT_FOUND
      const resCross = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${eventB.id}/registrations`,
        {
          method: "GET",
          headers: { cookie: adminACookie },
        },
      );
      expect(resCross.status).toBe(404);
      expect(((await resCross.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");

      // Non-member calling -> 403 FORBIDDEN
      const resNonMember = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${eventA.id}/registrations`,
        {
          method: "GET",
          headers: { cookie: ownerBCookie },
        },
      );
      expect(resNonMember.status).toBe(403);
      expect(((await resNonMember.json()) as { error: { code: string } }).error.code).toBe(
        "FORBIDDEN",
      );

      // Unauthenticated -> 401 UNAUTHENTICATED
      const resUnauth = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${eventA.id}/registrations`,
        {
          method: "GET",
        },
      );
      expect(resUnauth.status).toBe(401);
      expect(((await resUnauth.json()) as { error: { code: string } }).error.code).toBe(
        "UNAUTHENTICATED",
      );

      // Admin calling with invalid UUID -> 400 VALIDATION
      const resInvalidUuid = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/not-a-valid-uuid/registrations`,
        {
          method: "GET",
          headers: { cookie: adminACookie },
        },
      );
      expect(resInvalidUuid.status).toBe(400);
      expect(((await resInvalidUuid.json()) as { error: { code: string } }).error.code).toBe(
        "VALIDATION",
      );
    });

    it("R-5 调用前后数据库快照不变", async () => {
      const event = await createEvent(adminACookie, orgAId, {
        title: "R-5 Snapshot Consistency Event",
        capacity: 5,
      });

      await app.request(`http://localhost/api/orgs/${orgAId}/events/${event.id}/registrations`, {
        method: "POST",
        headers: { cookie: memberACookie },
      });

      const snapBefore = await getDbSnapshot();

      const res = await app.request(
        `http://localhost/api/orgs/${orgAId}/events/${event.id}/registrations`,
        {
          method: "GET",
          headers: { cookie: adminACookie },
        },
      );
      expect(res.status).toBe(200);

      const snapAfter = await getDbSnapshot();
      expect(snapAfter).toEqual(snapBefore);
    });

    it("D-8 500 映射：名单路由用 vi.spyOn 注入底层异常，断言 500 INTERNAL_ERROR，且响应不含 SQL 或内部细节", async () => {
      const event = await createEvent(adminACookie, orgAId, {
        title: "D-8 Spy Error Event",
        capacity: 10,
      });

      const originalSelect = db.select.bind(db);

      // 1. 基线测量：发正常请求，用 vi.spyOn(db, "select") 只计数不拦截（透传原实现），得到认证和中间件阶段会调用 db.select 的次数 K
      let K = 0;
      let firstHandlerEncountered = false;
      const baselineSpy = vi.spyOn(db, "select").mockImplementation((...args) => {
        const stack = new Error().stack ?? "";
        const isHandler = stack.includes("event-reads.ts");
        if (!isHandler && !firstHandlerEncountered) {
          K++;
        } else {
          firstHandlerEncountered = true;
        }
        return originalSelect(...args);
      });

      try {
        const baselineRes = await app.request(
          `http://localhost/api/orgs/${orgAId}/events/${event.id}/registrations`,
          {
            method: "GET",
            headers: { cookie: adminACookie },
          },
        );
        expect(baselineRes.status).toBe(200);
      } finally {
        baselineSpy.mockRestore();
      }

      console.log("Measured K for D-8 (GET event registrations):", K);
      expect(K).toBeGreaterThan(0);

      // 2. 正式用例：对前 K 次 db.select 透传原实现，从第 K+1 次起抛出异常
      let formalCallCount = 0;
      const errorSpy = vi.spyOn(db, "select").mockImplementation((...args) => {
        formalCallCount++;
        if (formalCallCount <= K) {
          return originalSelect(...args);
        }
        throw new Error(
          "Simulated database select failure: SELECT * FROM registrations; password=secret123 host=10.0.0.1",
        );
      });

      try {
        const res = await app.request(
          `http://localhost/api/orgs/${orgAId}/events/${event.id}/registrations`,
          {
            method: "GET",
            headers: { cookie: adminACookie },
          },
        );

        expect(res.status).toBe(500);
        const body = (await res.json()) as { error: { code: string; message: string } };
        expect(body).toEqual({
          error: {
            code: "INTERNAL_ERROR",
            message: "Failed to fetch event registrations",
          },
        });
        expect(body.error.message).not.toContain("password");
        expect(body.error.message).not.toContain("10.0.0.1");
        expect(body.error.message).not.toContain("SELECT");
        expect(body.error.message).not.toContain("secret123");
      } finally {
        errorSpy.mockRestore();
      }
    });
  });
});
