import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { isPostgresDatabaseError, type PostgresDatabaseError } from "./db-error-helper.ts";
import { setupTestDatabase, type TestDatabaseContext } from "./test-helper.ts";

let app: typeof import("./index.ts").app;

describe("T4: I7 Better Auth Team Management Integration Tests (a, b, c, d)", () => {
  let ctx: TestDatabaseContext;

  beforeAll(async () => {
    ctx = await setupTestDatabase();
    process.env.DATABASE_URL = ctx.testDbUrl;

    const mod = await import("./index.ts");
    app = mod.app;
  });

  afterAll(async () => {
    if (ctx) {
      await ctx.cleanup();
    }
  });

  async function registerUser(
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
    if (!res.ok) throw new Error(`Sign up failed for ${email}`);
    const setCookie = res.headers.get("set-cookie")!;
    const token = setCookie.match(/better-auth\.session_token=([^;]+)/)![1];
    const cookie = `better-auth.session_token=${token}`;

    const sessionRes = await app.request("http://localhost/api/auth/get-session", {
      headers: { cookie },
    });
    const userId = ((await sessionRes.json()) as { user: { id: string } }).user.id;
    return { cookie, userId };
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
    if (!res.ok) throw new Error(`Org creation failed for ${slug}`);
    const data = (await res.json()) as { id: string };
    return data.id;
  }

  async function addMember(orgId: string, userId: string, role: string): Promise<string> {
    const memberId = `mem_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    await ctx.pool.query(
      'INSERT INTO "member" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, NOW())',
      [memberId, orgId, userId, role],
    );
    return memberId;
  }

  describe("I7(a): Team Creation Authentication", () => {
    it("rejects unauthenticated team creation and accepts authenticated creation with owner role", async () => {
      const orgCountBefore = await ctx.pool.query('SELECT count(*)::int as c FROM "organization"');

      // 1. Unauthenticated creation must be rejected
      const resUnauth = await app.request("http://localhost/api/auth/organization/create", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ name: "Unauth Org", slug: "unauth-org" }),
      });
      expect(resUnauth.status).toBe(401);

      // Verify organization count unchanged
      const orgCountMiddle = await ctx.pool.query('SELECT count(*)::int as c FROM "organization"');
      expect(orgCountMiddle.rows[0].c).toBe(orgCountBefore.rows[0].c);

      // 2. Authenticated user creates team successfully
      const user = await registerUser("creator-i7a@example.com", "Creator I7a");
      const resAuth = await app.request("http://localhost/api/auth/organization/create", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          cookie: user.cookie,
        },
        body: JSON.stringify({ name: "Auth Org", slug: "auth-org-i7a" }),
      });
      expect(resAuth.status).toBe(200);
      const authOrgData = (await resAuth.json()) as { id: string };
      expect(authOrgData.id).toBeDefined();

      // Verify member row in newly created team has role 'owner'
      const memberRow = await ctx.pool.query(
        'SELECT role FROM "member" WHERE organization_id = $1 AND user_id = $2',
        [authOrgData.id, user.userId],
      );
      expect(memberRow.rows.length).toBe(1);
      expect(memberRow.rows[0].role).toBe("owner");
    });
  });

  describe("I7(b): Team Deletion Disabled (Full Row-Level DB Snapshot & Foreign Key Protection)", () => {
    async function getFullOrgSnapshot(targetOrgId: string) {
      const [orgRows, memberRows, eventRows, invitationRows, counts] = await Promise.all([
        ctx.pool.query<{ row_data: unknown }>(
          `SELECT to_jsonb(t.*) AS row_data FROM "organization" t WHERE t.id = $1`,
          [targetOrgId],
        ),
        ctx.pool.query<{ row_data: unknown }>(
          `SELECT to_jsonb(t.*) AS row_data FROM "member" t WHERE t.organization_id = $1 ORDER BY t.id ASC`,
          [targetOrgId],
        ),
        ctx.pool.query<{ row_data: unknown }>(
          `SELECT to_jsonb(t.*) AS row_data FROM "events" t WHERE t.organization_id = $1 ORDER BY t.id ASC`,
          [targetOrgId],
        ),
        ctx.pool.query<{ row_data: unknown }>(
          `SELECT to_jsonb(t.*) AS row_data FROM "invitation" t WHERE t.organization_id = $1 ORDER BY t.id ASC`,
          [targetOrgId],
        ),
        Promise.all([
          ctx.pool.query<{ c: number }>('SELECT count(*)::int as c FROM "organization"'),
          ctx.pool.query<{ c: number }>('SELECT count(*)::int as c FROM "member"'),
          ctx.pool.query<{ c: number }>('SELECT count(*)::int as c FROM "events"'),
          ctx.pool.query<{ c: number }>('SELECT count(*)::int as c FROM "invitation"'),
        ]),
      ]);

      return {
        org: orgRows.rows.map((r) => r.row_data),
        members: memberRows.rows.map((r) => r.row_data),
        events: eventRows.rows.map((r) => r.row_data),
        invitations: invitationRows.rows.map((r) => r.row_data),
        globalCounts: {
          orgCount: counts[0].rows[0].c,
          memberCount: counts[1].rows[0].c,
          eventCount: counts[2].rows[0].c,
          invitationCount: counts[3].rows[0].c,
        },
      };
    }

    it("rejects owner attempting to delete organization with ORGANIZATION_DELETION_DISABLED and preserves all rows verbatim", async () => {
      const owner = await registerUser("owner-i7b@example.com", "Owner I7b");
      const orgId = await createOrg(owner.cookie, "Delete Test Org", "delete-test-org-i7b");

      // Precondition: Org must have at least 1 event created by real owner
      const createEventRes = await app.request(`http://localhost/api/orgs/${orgId}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: owner.cookie,
        },
        body: JSON.stringify({
          title: "I7b Event",
          description: "I7b Event Description",
          startsAt: new Date(Date.now() + 10 * 86400000).toISOString(),
          registrationDeadline: new Date(Date.now() + 5 * 86400000).toISOString(),
          capacity: 10,
        }),
      });
      expect(createEventRes.status).toBe(201);

      // T0: Capture pre-deletion full row snapshots
      const preSnap = await getFullOrgSnapshot(orgId);
      expect(preSnap.org.length).toBe(1);
      expect(preSnap.members.length).toBe(1);
      expect(preSnap.events.length).toBe(1);

      // T1: Attempt deletion via API
      const resDelete = await app.request("http://localhost/api/auth/organization/delete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          cookie: owner.cookie,
        },
        body: JSON.stringify({ organizationId: orgId }),
      });

      // T2: HTTP assertion - Better Auth 1.7.11 returns HTTP 404 with ORGANIZATION_DELETION_DISABLED
      expect(resDelete.status).toBe(404);
      const body = (await resDelete.json()) as { code: string; message: string };
      expect(body.code).toBe("ORGANIZATION_DELETION_DISABLED");

      // T3 & T4: Capture post-deletion snapshots and perform deep equality assertions
      const postSnap = await getFullOrgSnapshot(orgId);
      expect(postSnap.org).toEqual(preSnap.org);
      expect(postSnap.members).toEqual(preSnap.members);
      expect(postSnap.events).toEqual(preSnap.events);
      expect(postSnap.invitations).toEqual(preSnap.invitations);
      expect(postSnap.globalCounts).toEqual(preSnap.globalCounts);
    });

    it("L5: direct SQL DELETE on organization with active events is rejected by foreign key constraint", async () => {
      const owner = await registerUser("owner-l5@example.com", "Owner L5");
      const orgId = await createOrg(owner.cookie, "L5 Test Org", "l5-test-org");

      const eventId = crypto.randomUUID();
      await ctx.pool.query(
        `INSERT INTO "events" (id, organization_id, title, description, starts_at, registration_deadline, capacity, status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW() + interval '10 days', NOW() + interval '5 days', 10, 'open', $5, NOW(), NOW())`,
        [eventId, orgId, "L5 Event", "L5 Event Description", owner.userId],
      );

      const client = await ctx.pool.connect();
      try {
        await client.query("BEGIN");
        let caughtDbError: unknown = undefined;
        let deleteSucceeded = false;
        try {
          await client.query(`DELETE FROM "organization" WHERE id = $1`, [orgId]);
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
        // In PostgreSQL <=17, RESTRICT raises 23503 (foreign_key_violation).
        // In PostgreSQL >=18 (used in CI), RESTRICT raises 23001 (restrict_violation) per SQL standard.
        expect(["23503", "23001"]).toContain(pgErr.code);
        expect(pgErr.constraint).toBe("events_organization_id_organization_id_fk");
      } finally {
        client.release();
      }
    });
  });

  describe("I7(d): Admin attempting to modify or remove Owner", () => {
    it("rejects admin modifying owner role or removing owner", async () => {
      const owner = await registerUser("owner-i7d@example.com", "Owner I7d");
      const admin = await registerUser("admin-i7d@example.com", "Admin I7d");
      const orgId = await createOrg(owner.cookie, "Org I7d", "org-i7d");

      // Find owner's memberId
      const ownerMemberRow = await ctx.pool.query(
        'SELECT id FROM "member" WHERE organization_id = $1 AND user_id = $2',
        [orgId, owner.userId],
      );
      const ownerMemberId = ownerMemberRow.rows[0].id;

      // Add admin to Org
      await addMember(orgId, admin.userId, "admin");

      // 1. Admin calls updateMemberRole on Owner (trying to downgrade owner to member)
      const resUpdate = await app.request(
        "http://localhost/api/auth/organization/update-member-role",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            cookie: admin.cookie,
          },
          body: JSON.stringify({
            organizationId: orgId,
            memberId: ownerMemberId,
            role: "member",
          }),
        },
      );
      expect(resUpdate.status).toBe(403);

      // Verify owner role in DB is STILL owner
      const checkOwnerRole = await ctx.pool.query('SELECT role FROM "member" WHERE id = $1', [
        ownerMemberId,
      ]);
      expect(checkOwnerRole.rows[0].role).toBe("owner");

      // 2. Admin calls removeMember on Owner
      const resRemove = await app.request("http://localhost/api/auth/organization/remove-member", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          cookie: admin.cookie,
        },
        body: JSON.stringify({
          organizationId: orgId,
          memberIdOrEmail: ownerMemberId,
        }),
      });
      expect(resRemove.status).toBe(400);

      // Verify owner STILL exists in member table
      const checkOwnerStillExists = await ctx.pool.query(
        'SELECT count(*)::int as c FROM "member" WHERE id = $1',
        [ownerMemberId],
      );
      expect(checkOwnerStillExists.rows[0].c).toBe(1);
    });
  });

  describe("I7(c): Member and Non-Member attempting to modify/remove target members, with Owner controls", () => {
    it("rejects member and non-member, while owner succeeds on independent targets", async () => {
      const ownerA = await registerUser("owner-i7c@example.com", "Owner I7c");
      const memberA = await registerUser("member-i7c@example.com", "Member I7c");
      const ownerB = await registerUser("owner-i7c-b@example.com", "Owner B I7c");

      const target1 = await registerUser("target1-i7c@example.com", "Target 1");
      const target2 = await registerUser("target2-i7c@example.com", "Target 2");

      const orgAId = await createOrg(ownerA.cookie, "Org I7c A", "org-i7c-a");
      await createOrg(ownerB.cookie, "Org I7c B", "org-i7c-b");

      await addMember(orgAId, memberA.userId, "member");
      const target1MemberId = await addMember(orgAId, target1.userId, "member");
      const target2MemberId = await addMember(orgAId, target2.userId, "member");

      // --- Part 1: Update Role on target1 ---
      // 1.1 Rejection: Member of Org A tries to update target1 role to admin
      const resMemberUpdate = await app.request(
        "http://localhost/api/auth/organization/update-member-role",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            cookie: memberA.cookie,
          },
          body: JSON.stringify({
            organizationId: orgAId,
            memberId: target1MemberId,
            role: "admin",
          }),
        },
      );
      expect(resMemberUpdate.status).not.toBe(200);

      // 1.2 Rejection: Non-member (Org B owner) tries to update target1 role to admin
      const resNonMemberUpdate = await app.request(
        "http://localhost/api/auth/organization/update-member-role",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            cookie: ownerB.cookie,
          },
          body: JSON.stringify({
            organizationId: orgAId,
            memberId: target1MemberId,
            role: "admin",
          }),
        },
      );
      expect(resNonMemberUpdate.status).not.toBe(200);

      // Target1 role must STILL be "member"
      const target1Check = await ctx.pool.query('SELECT role FROM "member" WHERE id = $1', [
        target1MemberId,
      ]);
      expect(target1Check.rows[0].role).toBe("member");

      // 1.3 Control: Owner of Org A updates target1 role to admin
      const resOwnerUpdate = await app.request(
        "http://localhost/api/auth/organization/update-member-role",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            cookie: ownerA.cookie,
          },
          body: JSON.stringify({
            organizationId: orgAId,
            memberId: target1MemberId,
            role: "admin",
          }),
        },
      );
      expect(resOwnerUpdate.status).toBe(200);

      // Target1 role in DB must now be "admin"
      const target1After = await ctx.pool.query('SELECT role FROM "member" WHERE id = $1', [
        target1MemberId,
      ]);
      expect(target1After.rows[0].role).toBe("admin");

      // --- Part 2: Remove Member on target2 ---
      // 2.1 Rejection: Member of Org A tries to remove target2
      const resMemberRemove = await app.request(
        "http://localhost/api/auth/organization/remove-member",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            cookie: memberA.cookie,
          },
          body: JSON.stringify({ organizationId: orgAId, memberIdOrEmail: target2MemberId }),
        },
      );
      expect(resMemberRemove.status).not.toBe(200);

      // 2.2 Rejection: Non-member (Org B owner) tries to remove target2
      const resNonMemberRemove = await app.request(
        "http://localhost/api/auth/organization/remove-member",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            cookie: ownerB.cookie,
          },
          body: JSON.stringify({ organizationId: orgAId, memberIdOrEmail: target2MemberId }),
        },
      );
      expect(resNonMemberRemove.status).not.toBe(200);

      // Target2 must STILL exist in member table
      const target2Check = await ctx.pool.query(
        'SELECT count(*)::int as c FROM "member" WHERE id = $1',
        [target2MemberId],
      );
      expect(target2Check.rows[0].c).toBe(1);

      // 2.3 Control: Owner of Org A removes target2
      const resOwnerRemove = await app.request(
        "http://localhost/api/auth/organization/remove-member",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            cookie: ownerA.cookie,
          },
          body: JSON.stringify({ organizationId: orgAId, memberIdOrEmail: target2MemberId }),
        },
      );
      expect(resOwnerRemove.status).toBe(200);

      // Target2 must now be deleted from member table
      const target2After = await ctx.pool.query(
        'SELECT count(*)::int as c FROM "member" WHERE id = $1',
        [target2MemberId],
      );
      expect(target2After.rows[0].c).toBe(0);
    });
  });
});
