import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { setupTestDatabase, type TestDatabaseContext } from "./test-helper.ts";
import { routesTable } from "./routes-table.ts";
import { exemptionsList } from "./routes-exemptions.ts";

let app: typeof import("./index.ts").app;
let db: typeof import("./auth.ts").db;

describe("T2: Auth Middleware, Route Table Integrity & Isolation Tests (I1, I2, I5)", () => {
  let ctx: TestDatabaseContext;
  let userA_MemberCookie: string;
  let userA_AdminCookie: string;
  let userA_OwnerCookie: string;
  let userB_OwnerCookie: string;
  let orgAId: string;
  let orgBId: string;

  beforeAll(async () => {
    ctx = await setupTestDatabase();
    process.env.DATABASE_URL = ctx.testDbUrl;

    const mod = await import("./index.ts");
    app = mod.app;
    const authMod = await import("./auth.ts");
    db = authMod.db;

    // Helper to register user and obtain session cookie
    async function createUserAndSession(
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
        throw new Error(`Failed to sign up ${email}: HTTP ${res.status} ${await res.text()}`);
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

    // Helper to create organization via Better Auth
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
        throw new Error(`Failed to create org ${slug}: HTTP ${res.status} ${await res.text()}`);
      }
      const data = (await res.json()) as { id: string };
      return data.id;
    }

    // Helper to add member directly to db
    async function addMember(orgId: string, userId: string, role: string) {
      await ctx.pool.query(
        'INSERT INTO "member" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, NOW())',
        [`mem_${Date.now()}_${Math.random()}`, orgId, userId, role],
      );
    }

    // Create users
    const ownerA = await createUserAndSession("owner-a@example.com", "Owner A");
    const adminA = await createUserAndSession("admin-a@example.com", "Admin A");
    const memberA = await createUserAndSession("member-a@example.com", "Member A");
    const ownerB = await createUserAndSession("owner-b@example.com", "Owner B");

    userA_OwnerCookie = ownerA.cookie;
    userA_AdminCookie = adminA.cookie;
    userA_MemberCookie = memberA.cookie;
    userB_OwnerCookie = ownerB.cookie;

    // Create orgs
    orgAId = await createOrg(userA_OwnerCookie, "Org A", "org-a");
    orgBId = await createOrg(userB_OwnerCookie, "Org B", "org-b");

    // Add admin and member to Org A
    await addMember(orgAId, adminA.userId, "admin");
    await addMember(orgAId, memberA.userId, "member");
  });

  afterAll(async () => {
    if (ctx) {
      await ctx.cleanup();
    }
  });

  describe("I1: Unauthenticated access returns 401", () => {
    it.each(routesTable)("rejects unauthenticated access for $method $path", async (route) => {
      const concretePath = route.path.replace(":orgId", orgAId);

      // Without cookie
      const resNoCookie = await app.request(`http://localhost${concretePath}`, {
        method: route.method,
      });
      expect(resNoCookie.status).toBe(401);
      const jsonNoCookie = await resNoCookie.json();
      expect(jsonNoCookie).toEqual({
        error: {
          code: "UNAUTHENTICATED",
          message: expect.any(String),
        },
      });

      // With forged/invalid cookie
      const resForgedCookie = await app.request(`http://localhost${concretePath}`, {
        method: route.method,
        headers: {
          cookie: "better-auth.session_token=forged-invalid-session-token",
        },
      });
      expect(resForgedCookie.status).toBe(401);
      const jsonForgedCookie = await resForgedCookie.json();
      expect(jsonForgedCookie).toEqual({
        error: {
          code: "UNAUTHENTICATED",
          message: expect.any(String),
        },
      });
    });
  });

  describe("I2: Organization isolation returns 403 and leaves DB unchanged", () => {
    async function getDbSnapshot() {
      const [orgs, members, invitations] = await Promise.all([
        ctx.pool.query('SELECT count(*)::int as c FROM "organization"'),
        ctx.pool.query('SELECT count(*)::int as c FROM "member"'),
        ctx.pool.query('SELECT count(*)::int as c FROM "invitation"'),
      ]);
      return {
        orgCount: orgs.rows[0].c,
        memberCount: members.rows[0].c,
        invitationCount: invitations.rows[0].c,
      };
    }

    it("rejects Org A member, admin, and owner accessing Org B with 403", async () => {
      const snapBefore = await getDbSnapshot();

      const callers = [
        { role: "member", cookie: userA_MemberCookie },
        { role: "admin", cookie: userA_AdminCookie },
        { role: "owner", cookie: userA_OwnerCookie },
      ];

      for (const caller of callers) {
        const res = await app.request(`http://localhost/api/orgs/${orgBId}/members`, {
          method: "GET",
          headers: { cookie: caller.cookie },
        });
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body).toEqual({
          error: {
            code: "FORBIDDEN",
            message: expect.any(String),
          },
        });
        // Must NOT leak Org B members
        expect(JSON.stringify(body)).not.toContain("owner-b@example.com");
      }

      const snapAfter = await getDbSnapshot();
      expect(snapAfter).toEqual(snapBefore);
    });

    it("returns 403 when orgId does not exist", async () => {
      const nonExistentOrgId = "non_existent_org_999999";
      const res = await app.request(`http://localhost/api/orgs/${nonExistentOrgId}/members`, {
        method: "GET",
        headers: { cookie: userA_OwnerCookie },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: {
          code: "FORBIDDEN",
          message: expect.any(String),
        },
      });
    });

    it("returns 403 when activeOrganizationId points to A but URL path points to B", async () => {
      // Set activeOrganizationId on session to Org A
      await ctx.pool.query('UPDATE "session" SET active_organization_id = $1', [orgAId]);

      const res = await app.request(`http://localhost/api/orgs/${orgBId}/members`, {
        method: "GET",
        headers: { cookie: userA_OwnerCookie },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: {
          code: "FORBIDDEN",
          message: expect.any(String),
        },
      });
    });
  });

  describe("I5: Route table integrity", () => {
    it("matches actual Hono routes minus exemptions exactly with routesTable", () => {
      // Filter out middleware handlers (middleware in Hono has signature (c, next), length === 2)
      const actualRoutes = app.routes
        .filter((r) => {
          if (r.path.includes("/*") && r.method === "ALL") return false;
          if (r.handler.length > 1) return false;
          return true;
        })
        .map((r) => ({
          method: r.method.toUpperCase(),
          path: r.path,
        }));

      // Deduplicate in case any route registered multiple handlers
      const uniqueMap = new Map<string, { method: string; path: string }>();
      for (const r of actualRoutes) {
        uniqueMap.set(`${r.method} ${r.path}`, r);
      }
      const uniqueActualRoutes = Array.from(uniqueMap.values());

      // Filter out exemptions
      const nonExemptRoutes = uniqueActualRoutes.filter((r) => {
        return !exemptionsList.some((ex) => ex.method === r.method && ex.path === r.path);
      });

      // Normalize paths: Hono uses /api/orgs/{orgId}/members for openapi routes
      const normalizedRoutes = nonExemptRoutes.map((r) => ({
        method: r.method,
        path: r.path.replace(/\{(\w+)\}/g, ":$1"),
      }));

      // Sort for set equality check
      const sortFn = (a: { method: string; path: string }, b: { method: string; path: string }) =>
        `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`);

      const expected = routesTable.map((r) => ({ method: r.method, path: r.path })).sort(sortFn);
      const actual = normalizedRoutes.sort(sortFn);

      expect(actual).toEqual(expected);
    });
  });

  describe("Supplementary Role & Security Tests", () => {
    it("allows member+ to access GET /api/orgs/:orgId/members and returns correct fields", async () => {
      const res = await app.request(`http://localhost/api/orgs/${orgAId}/members`, {
        method: "GET",
        headers: { cookie: userA_MemberCookie },
      });
      expect(res.status).toBe(200);
      const members = (await res.json()) as Array<{ userId: string; name: string; role: string }>;
      expect(Array.isArray(members)).toBe(true);
      expect(members.length).toBe(3); // owner, admin, member

      for (const m of members) {
        expect(m).toHaveProperty("userId");
        expect(m).toHaveProperty("name");
        expect(m).toHaveProperty("role");
        expect(m).not.toHaveProperty("email"); // Strict requirement: no email
      }
    });

    it("evaluates role based on path orgId when user is member in A and admin in B", async () => {
      // Register userAB and add as member in A, admin in B
      const res = await app.request("http://localhost/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          email: "user-ab@example.com",
          password: "password123456",
          name: "User AB",
        }),
      });
      const setCookie = res.headers.get("set-cookie")!;
      const token = setCookie.match(/better-auth\.session_token=([^;]+)/)![1];
      const cookie = `better-auth.session_token=${token}`;

      const sessionRes = await app.request("http://localhost/api/auth/get-session", {
        headers: { cookie },
      });
      const userId = ((await sessionRes.json()) as { user: { id: string } }).user.id;

      await ctx.pool.query(
        'INSERT INTO "member" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, NOW())',
        [`mem_ab_a_${Date.now()}`, orgAId, userId, "member"],
      );
      await ctx.pool.query(
        'INSERT INTO "member" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, NOW())',
        [`mem_ab_b_${Date.now()}`, orgBId, userId, "admin"],
      );

      // Can access Org A as member
      const resA = await app.request(`http://localhost/api/orgs/${orgAId}/members`, {
        headers: { cookie },
      });
      expect(resA.status).toBe(200);

      // Can access Org B as admin
      const resB = await app.request(`http://localhost/api/orgs/${orgBId}/members`, {
        headers: { cookie },
      });
      expect(resB.status).toBe(200);
    });

    it("immediately returns 403 when member row is deleted during an active session", async () => {
      // Register a temporary member in Org A
      const res = await app.request("http://localhost/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          email: "temp-member@example.com",
          password: "password123456",
          name: "Temp Member",
        }),
      });
      const setCookie = res.headers.get("set-cookie")!;
      const token = setCookie.match(/better-auth\.session_token=([^;]+)/)![1];
      const cookie = `better-auth.session_token=${token}`;
      const sessionRes = await app.request("http://localhost/api/auth/get-session", {
        headers: { cookie },
      });
      const userId = ((await sessionRes.json()) as { user: { id: string } }).user.id;

      await ctx.pool.query(
        'INSERT INTO "member" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, NOW())',
        [`mem_temp_${Date.now()}`, orgAId, userId, "member"],
      );

      // Should succeed
      const resBefore = await app.request(`http://localhost/api/orgs/${orgAId}/members`, {
        headers: { cookie },
      });
      expect(resBefore.status).toBe(200);

      // Delete member row
      await ctx.pool.query('DELETE FROM "member" WHERE user_id = $1 AND organization_id = $2', [
        userId,
        orgAId,
      ]);

      // Same session must immediately get 403
      const resAfter = await app.request(`http://localhost/api/orgs/${orgAId}/members`, {
        headers: { cookie },
      });
      expect(resAfter.status).toBe(403);
    });

    it("returns 500 INTERNAL_ERROR when database fails during auth check, never mapping to 401 or 403", async () => {
      const selectSpy = vi.spyOn(db, "select").mockImplementationOnce(() => {
        throw new Error("Simulated database failure");
      });

      try {
        const res = await app.request(`http://localhost/api/orgs/${orgAId}/members`, {
          method: "GET",
          headers: { cookie: userA_MemberCookie },
        });

        expect(res.status).toBe(500);
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
        const body = (await res.json()) as { error: { code: string; message: string } };
        expect(body).toEqual({
          error: {
            code: "INTERNAL_ERROR",
            message: "Internal server error",
          },
        });
        // Must NOT leak SQL or internal error stack
        expect(body.error.message).not.toContain("Simulated database failure");
        expect(body.error.message).not.toContain("SELECT");
      } finally {
        selectSpy.mockRestore();
      }
    });
  });
});
