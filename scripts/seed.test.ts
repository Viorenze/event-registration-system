import { describe, expect, it } from "vite-plus/test";
import {
  CookieJar,
  DEMO_PASSWORD,
  executeSeedCli,
  requestWithRetry,
  runSeed,
  validateLoopbackBaseUrl,
} from "./seed.ts";

interface RecordedRequest {
  url: string;
  method: string;
  headers: Headers;
  bodyText: string | undefined;
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function createJsonResponse(
  status: number,
  body: unknown,
  extraHeaders?: Array<[string, string]>,
): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (extraHeaders) {
    for (const [k, v] of extraHeaders) {
      headers.append(k, v);
    }
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function createStatefulFakeServer(options?: {
  inviteIdPrefix?: string;
  cookieTokenPrefix?: string;
}) {
  const invitePrefix = options?.inviteIdPrefix ?? "inv";
  const cookiePrefix = options?.cookieTokenPrefix ?? "sess";

  const requests: RecordedRequest[] = [];
  const sessions = new Map<string, { id: string; email: string }>();
  const orgs = new Map<string, { id: string; name: string; slug: string; ownerId: string }>();
  const invitations = new Map<
    string,
    { id: string; organizationId: string; email: string; role: string; accepted: boolean }
  >();
  const memberships = new Map<string, Set<string>>();
  const events = new Map<
    string,
    {
      id: string;
      organizationId: string;
      title: string;
      capacity: number;
      startsAt: string;
      registrationDeadline: string;
      description: string | null;
      confirmedCount: number;
    }
  >();

  let userSeq = 0;
  let orgSeq = 0;
  let inviteSeq = 0;
  let eventSeq = 0;
  let regSeq = 0;

  const signUps: Array<{ email: string; name: string; password: string }> = [];
  const orgCreates: Array<{ name: string; slug: string; ownerEmail: string }> = [];
  const inviteCreates: Array<{
    organizationId: string;
    email: string;
    role: string;
    inviterEmail: string;
  }> = [];
  const inviteAccepts: Array<{ invitationId: string; accepterEmail: string }> = [];
  const eventCreates: Array<{
    orgId: string;
    title: string;
    capacity: number;
    startsAt: string;
    registrationDeadline: string;
    description: unknown;
    creatorEmail: string;
  }> = [];
  const registrations: Array<{
    orgId: string;
    eventId: string;
    userEmail: string;
    status: string;
  }> = [];

  function getSessionFromCookie(headers: Headers): { id: string; email: string } | undefined {
    const cookieHeader = headers.get("cookie") ?? "";
    for (const part of cookieHeader.split(";")) {
      const trimmed = part.trim();
      if (trimmed.startsWith("better-auth.session_token=")) {
        const token = trimmed.slice("better-auth.session_token=".length);
        return sessions.get(token);
      }
    }
    return undefined;
  }

  const fakeFetch: typeof fetch = async (input, init) => {
    const urlStr = getRequestUrl(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const bodyText = typeof init?.body === "string" ? init.body : undefined;
    requests.push({ url: urlStr, method, headers, bodyText });

    const parsed = new URL(urlStr);
    const pathname = parsed.pathname;

    if (method === "POST" && pathname === "/api/auth/sign-up/email") {
      const payload = JSON.parse(bodyText ?? "{}") as {
        email: string;
        name: string;
        password: string;
      };
      signUps.push(payload);
      userSeq += 1;
      const userId = `user_${userSeq}`;
      const token = `${cookiePrefix}_${userSeq}`;
      sessions.set(token, { id: userId, email: payload.email });
      return createJsonResponse(
        200,
        { user: { id: userId, email: payload.email, name: payload.name } },
        [["set-cookie", `better-auth.session_token=${token}; Path=/; HttpOnly; SameSite=Lax`]],
      );
    }

    const sessionUser = getSessionFromCookie(headers);
    if (!sessionUser) {
      return createJsonResponse(401, {
        error: { code: "UNAUTHENTICATED", message: "Unauthorized" },
      });
    }

    if (method === "POST" && pathname === "/api/auth/organization/create") {
      const payload = JSON.parse(bodyText ?? "{}") as { name: string; slug: string };
      orgSeq += 1;
      const orgId = `org_${orgSeq}`;
      orgs.set(orgId, {
        id: orgId,
        name: payload.name,
        slug: payload.slug,
        ownerId: sessionUser.id,
      });
      memberships.set(orgId, new Set([sessionUser.email]));
      orgCreates.push({ name: payload.name, slug: payload.slug, ownerEmail: sessionUser.email });
      return createJsonResponse(200, { id: orgId, name: payload.name, slug: payload.slug });
    }

    if (method === "POST" && pathname === "/api/auth/organization/invite-member") {
      const payload = JSON.parse(bodyText ?? "{}") as {
        organizationId: string;
        email: string;
        role: string;
      };
      inviteSeq += 1;
      const inviteId = `${invitePrefix}_${inviteSeq}`;
      invitations.set(inviteId, {
        id: inviteId,
        organizationId: payload.organizationId,
        email: payload.email,
        role: payload.role,
        accepted: false,
      });
      inviteCreates.push({
        organizationId: payload.organizationId,
        email: payload.email,
        role: payload.role,
        inviterEmail: sessionUser.email,
      });
      return createJsonResponse(200, { id: inviteId, email: payload.email, role: payload.role });
    }

    if (method === "POST" && pathname === "/api/auth/organization/accept-invitation") {
      const payload = JSON.parse(bodyText ?? "{}") as { invitationId: string };
      const inv = invitations.get(payload.invitationId);
      if (!inv || inv.email !== sessionUser.email) {
        return createJsonResponse(403, { code: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION" });
      }
      inv.accepted = true;
      const orgMembers = memberships.get(inv.organizationId) ?? new Set<string>();
      orgMembers.add(sessionUser.email);
      memberships.set(inv.organizationId, orgMembers);
      inviteAccepts.push({ invitationId: payload.invitationId, accepterEmail: sessionUser.email });
      return createJsonResponse(200, {
        invitation: { id: inv.id, status: "accepted" },
        member: { userId: sessionUser.id, role: inv.role },
      });
    }

    const createEventMatch = pathname.match(/^\/api\/orgs\/([^/]+)\/events$/);
    if (method === "POST" && createEventMatch) {
      const orgId = createEventMatch[1];
      const payload = JSON.parse(bodyText ?? "{}") as {
        title: string;
        description?: string | null;
        startsAt: string;
        registrationDeadline: string;
        capacity: number;
      };
      eventSeq += 1;
      const eventId = `00000000-0000-4000-8000-${String(eventSeq).padStart(12, "0")}`;
      events.set(eventId, {
        id: eventId,
        organizationId: orgId,
        title: payload.title,
        capacity: payload.capacity,
        startsAt: payload.startsAt,
        registrationDeadline: payload.registrationDeadline,
        description: payload.description ?? null,
        confirmedCount: 0,
      });
      eventCreates.push({
        orgId,
        title: payload.title,
        capacity: payload.capacity,
        startsAt: payload.startsAt,
        registrationDeadline: payload.registrationDeadline,
        description: payload.description,
        creatorEmail: sessionUser.email,
      });
      return createJsonResponse(201, {
        id: eventId,
        organizationId: orgId,
        title: payload.title,
        description: payload.description ?? null,
        startsAt: payload.startsAt,
        registrationDeadline: payload.registrationDeadline,
        capacity: payload.capacity,
        status: "open",
        createdBy: sessionUser.id,
        createdAt: payload.startsAt,
        updatedAt: payload.startsAt,
      });
    }

    const registerMatch = pathname.match(/^\/api\/orgs\/([^/]+)\/events\/([^/]+)\/registrations$/);
    if (method === "POST" && registerMatch) {
      const [, orgId, eventId] = registerMatch;
      const ev = events.get(eventId);
      if (!ev || ev.organizationId !== orgId) {
        return createJsonResponse(404, { error: { code: "NOT_FOUND", message: "Not found" } });
      }
      const orgMembers = memberships.get(orgId);
      if (!orgMembers || !orgMembers.has(sessionUser.email)) {
        return createJsonResponse(403, { error: { code: "FORBIDDEN", message: "Forbidden" } });
      }
      regSeq += 1;
      const status = ev.confirmedCount < ev.capacity ? "confirmed" : "waitlisted";
      if (status === "confirmed") {
        ev.confirmedCount += 1;
      }
      registrations.push({ orgId, eventId, userEmail: sessionUser.email, status });
      return createJsonResponse(201, {
        id: `00000000-0000-4000-9000-${String(regSeq).padStart(12, "0")}`,
        eventId,
        userId: sessionUser.id,
        status,
        createdAt: ev.startsAt,
      });
    }

    return createJsonResponse(404, { error: { code: "NOT_FOUND", message: "Unhandled route" } });
  };

  return {
    fakeFetch,
    requests,
    signUps,
    orgCreates,
    inviteCreates,
    inviteAccepts,
    eventCreates,
    registrations,
  };
}

describe("scripts/seed.ts unit tests", () => {
  it("S1: loopback guard accepts loopback URLs and rejects invalid URLs", async () => {
    expect(validateLoopbackBaseUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(validateLoopbackBaseUrl("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(validateLoopbackBaseUrl("http://[::1]:3000")).toBe("http://[::1]:3000");

    const rejectedUrls = [
      "https://example.com",
      "http://192.168.1.5:3000",
      "http://localhost.evil.com",
      "http://localhost@evil.com",
      "http://0.0.0.0:3000",
    ];

    for (const badUrl of rejectedUrls) {
      expect(() => validateLoopbackBaseUrl(badUrl)).toThrow();
    }

    let fetchCount = 0;
    const logs: string[] = [];
    const exitCode = await executeSeedCli(
      ["--dry-run"],
      { SEED_BASE_URL: "http://example.com:3000" },
      {
        fetch: async () => {
          fetchCount += 1;
          return createJsonResponse(200, {});
        },
        log: (line) => logs.push(line),
      },
    );

    expect(exitCode).toBe(1);
    expect(fetchCount).toBe(0);
    expect(logs.length).toBeGreaterThan(0);
  });

  it("S2: cookie jar extracts name=value, overwrites duplicates, ignores attrs", () => {
    const jar = new CookieJar();

    const firstHeaders = new Headers();
    firstHeaders.append("set-cookie", "a=1; Path=/; HttpOnly; SameSite=Lax");
    firstHeaders.append("set-cookie", "b=initial; Path=/auth; Max-Age=600");
    jar.applySetCookies(firstHeaders);

    const secondHeaders = new Headers();
    secondHeaders.append("set-cookie", "b=2; Path=/; HttpOnly; Secure");
    jar.applySetCookies(secondHeaders);

    expect(jar.toCookieHeader()).toBe("a=1; b=2");
  });

  it("S3: POST sends Content-Type json and Origin; GET omits Content-Type", async () => {
    const captured: RecordedRequest[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const urlStr = getRequestUrl(input);
      captured.push({
        url: urlStr,
        method: (init?.method ?? "GET").toUpperCase(),
        headers: new Headers(init?.headers),
        bodyText: typeof init?.body === "string" ? init.body : undefined,
      });
      return createJsonResponse(200, { ok: true });
    };

    const jar = new CookieJar();
    await requestWithRetry({
      baseOrigin: "http://127.0.0.1:3000",
      path: "/api/test-post",
      method: "POST",
      body: { hello: "world" },
      jar,
      stepName: "test-post",
      fetchFn: fakeFetch,
      sleepFn: async () => {},
    });

    await requestWithRetry({
      baseOrigin: "http://127.0.0.1:3000",
      path: "/api/test-empty-post",
      method: "POST",
      jar,
      stepName: "test-empty-post",
      fetchFn: fakeFetch,
      sleepFn: async () => {},
    });

    await requestWithRetry({
      baseOrigin: "http://127.0.0.1:3000",
      path: "/api/test-get",
      method: "GET",
      jar,
      stepName: "test-get",
      fetchFn: fakeFetch,
      sleepFn: async () => {},
    });

    expect(captured).toHaveLength(3);

    for (const postReq of [captured[0], captured[1]]) {
      expect(postReq.method).toBe("POST");
      expect(postReq.headers.get("content-type")).toBe("application/json");
      expect(postReq.headers.get("origin")).toBe("http://127.0.0.1:3000");
      expect(typeof postReq.bodyText).toBe("string");
      expect(() => JSON.parse(postReq.bodyText as string)).not.toThrow();
    }

    const getReq = captured[2];
    expect(getReq.method).toBe("GET");
    expect(getReq.headers.get("origin")).toBe("http://127.0.0.1:3000");
    expect(getReq.headers.has("content-type")).toBe(false);
    expect(getReq.bodyText).toBeUndefined();
  });

  it("S4: retries 429 with >=10000ms sleep; throws without body after 4x 429", async () => {
    let calls1 = 0;
    const sleeps1: number[] = [];
    const res1 = await requestWithRetry({
      baseOrigin: "http://localhost:3000",
      path: "/api/rate-limited",
      method: "POST",
      body: { test: 1 },
      jar: new CookieJar(),
      stepName: "retry-success",
      fetchFn: async () => {
        calls1 += 1;
        if (calls1 <= 2) {
          return new Response("too fast", { status: 429 });
        }
        return createJsonResponse(200, { ok: true });
      },
      sleepFn: async (ms) => {
        sleeps1.push(ms);
      },
    });

    expect(res1.status).toBe(200);
    expect(calls1).toBe(3);
    expect(sleeps1).toHaveLength(2);
    expect(sleeps1.every((ms) => ms >= 10000)).toBe(true);

    let calls2 = 0;
    const sleeps2: number[] = [];
    const secretBodySentinel = "RATE_LIMIT_BODY_SECRET_9911";
    let caughtError: unknown;
    try {
      await requestWithRetry({
        baseOrigin: "http://localhost:3000",
        path: "/api/rate-limited-fail",
        method: "POST",
        body: { test: 2 },
        jar: new CookieJar(),
        stepName: "retry-exhausted",
        fetchFn: async () => {
          calls2 += 1;
          return new Response(secretBodySentinel, {
            status: 429,
            headers: { "x-retry-after": "12" },
          });
        },
        sleepFn: async (ms) => {
          sleeps2.push(ms);
        },
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(Error);
    expect(calls2).toBe(4);
    expect(sleeps2).toEqual([12000, 12000, 12000]);
    const errMsg = caughtError instanceof Error ? caughtError.message : String(caughtError);
    expect(errMsg.includes(secretBodySentinel)).toBe(false);
  });

  it("S5: already-seeded returns exit 3 on 422; exits 1 on 500", async () => {
    let callsAlready = 0;
    const fakeFetchAlready: typeof fetch = async () => {
      callsAlready += 1;
      return createJsonResponse(422, {
        code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
        message: "User already exists. Use another email.",
      });
    };

    const logsAlready: string[] = [];
    const now = () => new Date();
    const result = await runSeed({
      baseUrl: "http://localhost:3000",
      fetch: fakeFetchAlready,
      sleep: async () => {},
      now,
      log: (line) => logsAlready.push(line),
    });

    expect(result).toBe("already-seeded");
    expect(callsAlready).toBe(1);
    expect(logsAlready.some((line) => line.length > 0)).toBe(true);

    let cliCallsAlready = 0;
    const cliCodeAlready = await executeSeedCli(
      [],
      {},
      {
        fetch: async () => {
          cliCallsAlready += 1;
          return createJsonResponse(422, {
            code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
            message: "User already exists. Use another email.",
          });
        },
        sleep: async () => {},
        now,
        log: () => {},
      },
    );
    expect(cliCodeAlready).toBe(3);
    expect(cliCallsAlready).toBe(1);

    let cliCalls500 = 0;
    const logs500: string[] = [];
    const errorSentinel = "INTERNAL_DB_DETAILS_SENTINEL_5544";
    const cliCode500 = await executeSeedCli(
      [],
      {},
      {
        fetch: async () => {
          cliCalls500 += 1;
          return createJsonResponse(500, { error: errorSentinel });
        },
        sleep: async () => {},
        now,
        log: (line) => logs500.push(line),
      },
    );
    expect(cliCode500).toBe(1);
    expect(cliCalls500).toBe(1);
    expect(logs500.some((l) => l.includes(errorSentinel))).toBe(false);
  });

  it("S6: never logs invitation IDs or session cookie tokens", async () => {
    const server = createStatefulFakeServer({
      inviteIdPrefix: "INV_SENTINEL_9F3A",
      cookieTokenPrefix: "COOKIE_SENTINEL_7C21",
    });
    const logs: string[] = [];
    const fixedNow = new Date();

    const exitCode = await executeSeedCli(
      [],
      {},
      {
        fetch: server.fakeFetch,
        sleep: async () => {},
        now: () => new Date(fixedNow.getTime()),
        log: (line) => logs.push(line),
      },
    );

    expect(exitCode).toBe(0);
    expect(logs.length).toBeGreaterThan(0);

    const leakedInvite = logs.some((line) => line.includes("INV_SENTINEL_9F3A"));
    const leakedCookie = logs.some((line) => line.includes("COOKIE_SENTINEL_7C21"));
    expect(leakedInvite).toBe(false);
    expect(leakedCookie).toBe(false);
  });

  it("S9a: never logs the demo password it sends in sign-up requests", async () => {
    // 它防的是 seed 的日志里出现它发送或将要发送的口令
    const server = createStatefulFakeServer();
    const logs: string[] = [];
    const fixedNow = new Date();

    const exitCode = await executeSeedCli(
      [],
      {},
      {
        fetch: server.fakeFetch,
        sleep: async () => {},
        now: () => new Date(fixedNow.getTime()),
        log: (line) => logs.push(line),
      },
    );

    const sentPasswords = new Set<string>();
    for (const req of server.requests) {
      if (req.method === "POST" && new URL(req.url).pathname === "/api/auth/sign-up/email") {
        const parsed = JSON.parse(req.bodyText ?? "{}") as { password?: unknown };
        if (typeof parsed.password === "string") {
          sentPasswords.add(parsed.password);
        }
      }
    }

    expect(exitCode === 0).toBe(true);
    expect(sentPasswords.size > 0).toBe(true);
    expect(Array.from(sentPasswords).every((p) => p.length >= 8)).toBe(true);
    expect(logs.length > 0).toBe(true);

    const leaked = logs.some((line) => Array.from(sentPasswords).some((pw) => line.includes(pw)));
    expect(leaked).toBe(false);
  });

  it("S9b: --dry-run does not log the demo password", async () => {
    // 它防的是 seed 的日志里出现它发送或将要发送的口令
    let fetchCalls = 0;
    const logs: string[] = [];
    const fixedNow = new Date();

    const exitCode = await executeSeedCli(
      ["--dry-run"],
      {},
      {
        fetch: async () => {
          fetchCalls += 1;
          return createJsonResponse(200, {});
        },
        sleep: async () => {},
        now: () => new Date(fixedNow.getTime()),
        log: (line) => logs.push(line),
      },
    );

    expect(exitCode === 0).toBe(true);
    expect(fetchCalls === 0).toBe(true);
    expect(logs.length > 0).toBe(true);
    expect(DEMO_PASSWORD.length >= 8).toBe(true);

    const leaked = logs.some((line) => line.includes(DEMO_PASSWORD));
    expect(leaked).toBe(false);
  });

  it("S7: full seed flow creates all entities with sleep(4000) and relative dates", async () => {
    const server = createStatefulFakeServer();
    const logs: string[] = [];
    const timeline: string[] = [];
    const sleepCalls: number[] = [];

    const capturedNow = new Date();
    const expectedStartsAt = new Date(
      capturedNow.getTime() + 14 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const expectedDeadline = new Date(
      capturedNow.getTime() + 10 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const wrappedFetch: typeof fetch = async (input, init) => {
      const urlStr = getRequestUrl(input);
      if (new URL(urlStr).pathname === "/api/auth/sign-up/email") {
        const bodyText = typeof init?.body === "string" ? init.body : "{}";
        const parsed = JSON.parse(bodyText) as { email?: string };
        timeline.push(`signup:${parsed.email ?? ""}`);
      }
      return server.fakeFetch(input, init);
    };

    const result = await runSeed({
      baseUrl: "http://localhost:3000",
      fetch: wrappedFetch,
      sleep: async (ms) => {
        sleepCalls.push(ms);
        timeline.push(`sleep:${ms}`);
      },
      now: () => new Date(capturedNow.getTime()),
      log: (line) => logs.push(line),
    });

    expect(result).toBe("seeded");

    expect(DEMO_PASSWORD.length).toBeGreaterThanOrEqual(8);
    expect(server.signUps).toHaveLength(9);
    expect(server.signUps.every((u) => u.password === DEMO_PASSWORD)).toBe(true);

    expect(sleepCalls).toHaveLength(8);
    expect(sleepCalls.every((ms) => ms === 4000)).toBe(true);
    expect(timeline[0]).toBe("signup:demo-owner-a@example.com");
    expect(timeline[1]).toBe("sleep:4000");

    expect(server.orgCreates).toHaveLength(2);
    expect(server.orgCreates.map((o) => o.slug)).toEqual(["demo-org-a", "demo-org-b"]);

    expect(server.inviteCreates).toHaveLength(7);
    const orgAInvites = server.inviteCreates.filter((i) => i.organizationId === "org_1");
    const orgBInvites = server.inviteCreates.filter((i) => i.organizationId === "org_2");
    expect(orgAInvites).toHaveLength(6);
    expect(orgBInvites).toHaveLength(1);
    expect(orgAInvites.find((i) => i.email === "demo-admin-a@example.com")?.role).toBe("admin");

    expect(server.inviteAccepts).toHaveLength(7);

    expect(server.eventCreates).toHaveLength(3);
    expect(server.eventCreates.map((e) => e.title)).toEqual([
      "Demo: Small Workshop (3 spots)",
      "Demo: Open Meetup (50 spots)",
      "Demo: Org B Private Event",
    ]);
    for (const ev of server.eventCreates) {
      expect(ev.startsAt).toBe(expectedStartsAt);
      expect(ev.registrationDeadline).toBe(expectedDeadline);
    }

    expect(server.registrations).toHaveLength(6);
    const workshopRegs = server.registrations.filter(
      (r) => r.eventId === "00000000-0000-4000-8000-000000000001",
    );
    expect(workshopRegs).toHaveLength(5);
    expect(workshopRegs.map((r) => r.status)).toEqual([
      "confirmed",
      "confirmed",
      "confirmed",
      "waitlisted",
      "waitlisted",
    ]);
    const orgBRegs = server.registrations.filter(
      (r) => r.eventId === "00000000-0000-4000-8000-000000000003",
    );
    expect(orgBRegs).toHaveLength(1);
    expect(orgBRegs[0].status).toBe("confirmed");

    for (const req of server.requests) {
      expect(req.method).toBe("POST");
      expect(req.headers.get("content-type")).toBe("application/json");
      expect(req.headers.get("origin")).toBe("http://localhost:3000");
      expect(() => JSON.parse(req.bodyText ?? "")).not.toThrow();
    }

    const joinedLogs = logs.join("\n");
    expect(joinedLogs).toContain("Demo Org A");
    expect(joinedLogs).toContain("Demo Org B");
    expect(joinedLogs).toContain("Demo: Small Workshop (3 spots)");
    expect(joinedLogs).toContain("Demo: Open Meetup (50 spots)");
    expect(joinedLogs).toContain("Demo: Org B Private Event");
  });

  it("S8: --dry-run makes zero fetch calls, logs summary, and exits 0", async () => {
    let fetchCalls = 0;
    const logs: string[] = [];
    const capturedNow = new Date();

    const exitCode = await executeSeedCli(
      ["--dry-run"],
      {},
      {
        fetch: async () => {
          fetchCalls += 1;
          return createJsonResponse(200, {});
        },
        sleep: async () => {},
        now: () => new Date(capturedNow.getTime()),
        log: (line) => logs.push(line),
      },
    );

    expect(exitCode).toBe(0);
    expect(fetchCalls).toBe(0);

    const output = logs.join("\n");
    expect(output).toContain("Demo Org A");
    expect(output).toContain("Demo Org B");
    expect(output).toContain("demo-owner-a@example.com");
    expect(output).toContain("Demo: Small Workshop (3 spots)");
  });
});
