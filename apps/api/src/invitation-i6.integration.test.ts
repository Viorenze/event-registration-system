import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { setupTestDatabase, type TestDatabaseContext } from "./test-helper.ts";

let app: typeof import("./index.ts").app;

describe("T3: I6 Better Auth Invitation Integration Test", () => {
  let ctx: TestDatabaseContext;
  let ownerACookie: string;
  let adminACookie: string;
  let memberACookie: string;
  let ownerBCookie: string;
  let orgAId: string;
  let _orgBId: string;

  beforeAll(async () => {
    ctx = await setupTestDatabase();
    process.env.DATABASE_URL = ctx.testDbUrl;

    const mod = await import("./index.ts");
    app = mod.app;

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

    // 1. Create users
    const ownerA = await registerUser("owner-i6-a@example.com", "Owner I6 A");
    const adminA = await registerUser("admin-i6-a@example.com", "Admin I6 A");
    const memberA = await registerUser("member-i6-a@example.com", "Member I6 A");
    const ownerB = await registerUser("owner-i6-b@example.com", "Owner I6 B");

    ownerACookie = ownerA.cookie;
    adminACookie = adminA.cookie;
    memberACookie = memberA.cookie;
    ownerBCookie = ownerB.cookie;

    // 2. Create organizations
    orgAId = await createOrg(ownerACookie, "Org I6 A", "org-i6-a");
    _orgBId = await createOrg(ownerBCookie, "Org I6 B", "org-i6-b");

    // 3. Add admin and member to Org A via Better Auth organization/create (owner did it)
    // Add adminA to Org A with role "admin"
    await ctx.pool.query(
      'INSERT INTO "member" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, NOW())',
      [`mem_admin_a_${Date.now()}`, orgAId, adminA.userId, "admin"],
    );
    // Add memberA to Org A with role "member"
    await ctx.pool.query(
      'INSERT INTO "member" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, NOW())',
      [`mem_member_a_${Date.now()}`, orgAId, memberA.userId, "member"],
    );
  });

  afterAll(async () => {
    if (ctx) {
      await ctx.cleanup();
    }
  });

  it("I6 Creation: rejects member and non-member, accepts admin and owner", async () => {
    // 1. Rejection: A organization member tries to create invitation for Org A
    const resMember = await app.request("http://localhost/api/auth/organization/invite-member", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        cookie: memberACookie,
      },
      body: JSON.stringify({
        email: "target-member-try@example.com",
        role: "member",
        organizationId: orgAId,
      }),
    });
    // Better Auth returns 403 when user has insufficient permissions to invite
    expect(resMember.status).toBe(403);
    const memberBody = (await resMember.json()) as { code: string };
    expect(memberBody.code).toBe("YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION");

    // Verify invitation table has 0 rows
    const inviteCount1 = await ctx.pool.query(
      'SELECT count(*)::int as c FROM "invitation" WHERE organization_id = $1',
      [orgAId],
    );
    expect(inviteCount1.rows[0].c).toBe(0);

    // 2. Rejection: B organization owner (not member of Org A) tries to create invitation for Org A
    const resNonMember = await app.request("http://localhost/api/auth/organization/invite-member", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        cookie: ownerBCookie,
      },
      body: JSON.stringify({
        email: "target-nonmember-try@example.com",
        role: "member",
        organizationId: orgAId,
      }),
    });
    expect(resNonMember.status).toBe(400);
    const nonMemberBody = (await resNonMember.json()) as { code: string; message: string };
    expect(nonMemberBody.code).toBe("MEMBER_NOT_FOUND");

    // Verify invitation table has 0 rows
    const inviteCount2 = await ctx.pool.query(
      'SELECT count(*)::int as c FROM "invitation" WHERE organization_id = $1',
      [orgAId],
    );
    expect(inviteCount2.rows[0].c).toBe(0);

    // 3. Control group: Org A owner creates invitation
    const resOwner = await app.request("http://localhost/api/auth/organization/invite-member", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        cookie: ownerACookie,
      },
      body: JSON.stringify({
        email: "target-owner-invite@example.com",
        role: "member",
        organizationId: orgAId,
      }),
    });
    expect(resOwner.status).toBe(200);
    const ownerInviteData = (await resOwner.json()) as { id: string };
    expect(ownerInviteData.id).toBeDefined();

    // Verify invitation table has 1 row
    const inviteCount3 = await ctx.pool.query(
      'SELECT count(*)::int as c FROM "invitation" WHERE organization_id = $1',
      [orgAId],
    );
    expect(inviteCount3.rows[0].c).toBe(1);

    // 4. Control group: Org A admin creates invitation
    const resAdmin = await app.request("http://localhost/api/auth/organization/invite-member", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        cookie: adminACookie,
      },
      body: JSON.stringify({
        email: "target-admin-invite@example.com",
        role: "member",
        organizationId: orgAId,
      }),
    });
    expect(resAdmin.status).toBe(200);
    const adminInviteData = (await resAdmin.json()) as { id: string };
    expect(adminInviteData.id).toBeDefined();

    // Verify invitation table has 2 rows
    const inviteCount4 = await ctx.pool.query(
      'SELECT count(*)::int as c FROM "invitation" WHERE organization_id = $1',
      [orgAId],
    );
    expect(inviteCount4.rows[0].c).toBe(2);
  });

  it("I6 Acceptance: rejects mismatched recipient, accepts matching recipient", async () => {
    // Admin A creates an invitation for "match-user@example.com"
    const createRes = await app.request("http://localhost/api/auth/organization/invite-member", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        cookie: adminACookie,
      },
      body: JSON.stringify({
        email: "match-user@example.com",
        role: "member",
        organizationId: orgAId,
      }),
    });
    expect(createRes.status).toBe(200);
    const inviteData = (await createRes.json()) as { id: string };
    const invitationId = inviteData.id;

    // Register mismatched user
    const resMismatched = await app.request("http://localhost/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({
        email: "wrong-user@example.com",
        password: "password123456",
        name: "Wrong User",
      }),
    });
    const mismatchToken = resMismatched.headers
      .get("set-cookie")!
      .match(/better-auth\.session_token=([^;]+)/)![1];
    const mismatchCookie = `better-auth.session_token=${mismatchToken}`;

    // Register matching user
    const resMatched = await app.request("http://localhost/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({
        email: "match-user@example.com",
        password: "password123456",
        name: "Match User",
      }),
    });
    const matchToken = resMatched.headers
      .get("set-cookie")!
      .match(/better-auth\.session_token=([^;]+)/)![1];
    const matchCookie = `better-auth.session_token=${matchToken}`;

    const memberCountBefore = await ctx.pool.query(
      'SELECT count(*)::int as c FROM "member" WHERE organization_id = $1',
      [orgAId],
    );

    // 1. Rejection first: Mismatched recipient attempts to accept
    const resAcceptMismatch = await app.request(
      "http://localhost/api/auth/organization/accept-invitation",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          cookie: mismatchCookie,
        },
        body: JSON.stringify({ invitationId }),
      },
    );
    expect(resAcceptMismatch.status).toBe(403);
    const mismatchBody = (await resAcceptMismatch.json()) as { code: string };
    expect(mismatchBody.code).toBe("YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION");

    // Member count in DB must NOT change
    const memberCountMiddle = await ctx.pool.query(
      'SELECT count(*)::int as c FROM "member" WHERE organization_id = $1',
      [orgAId],
    );
    expect(memberCountMiddle.rows[0].c).toBe(memberCountBefore.rows[0].c);

    // 2. Acceptance second: Matching recipient attempts to accept
    const resAcceptMatch = await app.request(
      "http://localhost/api/auth/organization/accept-invitation",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          cookie: matchCookie,
        },
        body: JSON.stringify({ invitationId }),
      },
    );
    expect(resAcceptMatch.status).toBe(200);
    const matchBody = (await resAcceptMatch.json()) as {
      invitation: { status: string };
      member: { role: string; userId: string };
    };
    expect(matchBody.invitation.status).toBe("accepted");
    expect(matchBody.member.role).toBe("member");

    // Member count must increase by 1
    const memberCountAfter = await ctx.pool.query(
      'SELECT count(*)::int as c FROM "member" WHERE organization_id = $1',
      [orgAId],
    );
    expect(memberCountAfter.rows[0].c).toBe(memberCountBefore.rows[0].c + 1);

    // Verify newly added member role in DB
    const newMemberRow = await ctx.pool.query(
      'SELECT role FROM "member" WHERE organization_id = $1 AND user_id = $2',
      [orgAId, matchBody.member.userId],
    );
    expect(newMemberRow.rows[0].role).toBe("member");
  });
});
