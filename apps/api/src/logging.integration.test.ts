import util from "node:util";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { resetLogSink, setLogLevel, setLogSink } from "./logger.ts";
import { setupTestDatabase, type TestDatabaseContext } from "./test-helper.ts";

let app: typeof import("./index.ts").app;
let auth: typeof import("./auth.ts").auth;
let db: typeof import("./auth.ts").db;

describe("S6 Logging Integration Tests (L2 - L9)", () => {
  let ctx: TestDatabaseContext;
  let ownerCookie: string;
  let ownerUserId: string;
  let orgId: string;
  let capturedLogs: string[] = [];

  beforeAll(async () => {
    setLogSink((line) => {
      capturedLogs.push(line);
    });
    ctx = await setupTestDatabase();
    process.env.DATABASE_URL = ctx.testDbUrl;

    const mod = await import("./index.ts");
    app = mod.app;
    const authMod = await import("./auth.ts");
    auth = authMod.auth;
    db = authMod.db;

    // Helper to create user and session
    async function createUser(email: string, name: string) {
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

    // Helper to create org
    async function createOrg(cookie: string, name: string, slug: string) {
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

    const owner = await createUser("logging-owner@example.com", "Logging Owner");
    ownerCookie = owner.cookie;
    ownerUserId = owner.userId;
    orgId = await createOrg(ownerCookie, "Logging Org", "logging-org");
  });

  afterAll(async () => {
    resetLogSink();
    setLogLevel("info");
    if (ctx) {
      await ctx.cleanup();
    }
  });

  beforeEach(() => {
    capturedLogs = [];
    setLogSink((line) => {
      capturedLogs.push(line);
    });
    setLogLevel("info");
  });

  afterEach(() => {
    resetLogSink();
    setLogLevel("info");
    vi.restoreAllMocks();
  });

  it("L2: logs exactly one request log for authorized org request with required fields, and null userId on 401", async () => {
    // 1. Authorized org request with query string
    const resAuth = await app.request(
      `http://localhost/api/orgs/${orgId}/members?foo=bar&baz=123`,
      {
        method: "GET",
        headers: {
          cookie: ownerCookie,
        },
      },
    );

    expect(resAuth.status).toBe(200);
    const reqHeaderId = resAuth.headers.get("x-request-id");
    expect(reqHeaderId).toBeTruthy();

    const authLogs = capturedLogs
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((l) => l.requestId === reqHeaderId);

    expect(authLogs).toHaveLength(1);
    const authLog = authLogs[0];
    expect(authLog.requestId).toBe(reqHeaderId);
    expect(authLog.method).toBe("GET");
    expect(authLog.path).toBe(`/api/orgs/${orgId}/members`);
    expect(authLog.path).not.toContain("foo=bar");
    expect(authLog.status).toBe(200);
    expect(typeof authLog.durationMs).toBe("number");
    expect(authLog.durationMs as number).toBeGreaterThanOrEqual(0);
    expect(authLog.userId).toBe(ownerUserId);
    expect(authLog.orgId).toBe(orgId);

    // 2. Unauthenticated request returning 401
    capturedLogs = [];
    const resUnauth = await app.request(`http://localhost/api/orgs/${orgId}/members`, {
      method: "GET",
    });

    expect(resUnauth.status).toBe(401);
    const unauthHeaderId = resUnauth.headers.get("x-request-id");
    expect(unauthHeaderId).toBeTruthy();

    const unauthLogs = capturedLogs
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((l) => l.requestId === unauthHeaderId);

    expect(unauthLogs).toHaveLength(1);
    const unauthLog = unauthLogs[0];
    expect(unauthLog.status).toBe(401);
    expect(unauthLog.userId).toBeNull();
    expect(unauthLog.orgId).toBeNull();
  });

  it("L3: never leaks passwords, cookies, authorization tokens, invitation ids, or Set-Cookie values in logs", async () => {
    const SENTINEL_PASSWORD = "SENTINEL_LEAK_SECRET_PWD_987654";
    const SENTINEL_COOKIE = "SENTINEL_LEAK_COOKIE_TOKEN_987654";
    const SENTINEL_AUTH_HEADER = "Bearer SENTINEL_LEAK_AUTH_TOKEN_987654";
    const SENTINEL_INVITATION_ID = "SENTINEL_LEAK_INVITATION_ID_987654";

    // 1. Sign-in request with sentinel password (failed sign-in)
    const signInRes = await app.request("http://localhost/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        email: "logging-owner@example.com",
        password: SENTINEL_PASSWORD,
      }),
    });
    expect(signInRes.status).toBe(401);

    // 2. Request with sentinel Cookie and Authorization headers
    await app.request(`http://localhost/api/orgs/${orgId}/members`, {
      method: "GET",
      headers: {
        cookie: `better-auth.session_token=${SENTINEL_COOKIE}`,
        authorization: SENTINEL_AUTH_HEADER,
      },
    });

    // 3. Request with sentinel invitation id
    await app.request("http://localhost/api/auth/organization/accept-invitation", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        cookie: ownerCookie,
      },
      body: JSON.stringify({
        invitationId: SENTINEL_INVITATION_ID,
      }),
    });

    // 4. Successful sign-in that actually returns a Set-Cookie header
    const validSignInRes = await app.request("http://localhost/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        email: "logging-owner@example.com",
        password: "password123456",
      }),
    });
    expect(validSignInRes.status).toBe(200);
    const validSetCookie = validSignInRes.headers.get("set-cookie");
    expect(validSetCookie).toBeTruthy();
    const tokenMatch = validSetCookie?.match(/better-auth\.session_token=([^;]+)/);
    expect(tokenMatch?.[1]).toBeTruthy();
    const validToken = tokenMatch![1];

    expect(capturedLogs.length).toBeGreaterThan(0);

    for (const logLine of capturedLogs) {
      expect(logLine).not.toContain(SENTINEL_PASSWORD);
      expect(logLine).not.toContain(SENTINEL_COOKIE);
      expect(logLine).not.toContain(SENTINEL_AUTH_HEADER);
      expect(logLine).not.toContain(SENTINEL_INVITATION_ID);
      expect(logLine).not.toContain(validToken);
      expect(logLine).not.toContain(validSetCookie!);
    }
  });

  it("L4: fault injection produces 500 response, exactly one error log without leaked message/stack sentinels", async () => {
    const SENTINEL_ERR_MSG = "SENTINEL_CONFIDENTIAL_DB_ERROR_123";
    const SENTINEL_STACK = "SENTINEL_SECRET_STACK_CALLER_456";
    const SENTINEL_CAUSE_MSG = "SENTINEL_CAUSE_SECRET_MSG_789";

    const customError = new Error(`${SENTINEL_ERR_MSG}\n    at ${SENTINEL_STACK}`);
    customError.name = "CustomFaultInjectionError";
    (customError as unknown as { code: string }).code = "ERR_FAULT_INJECTED";
    customError.stack = `Error: ${SENTINEL_ERR_MSG}\n    at ${SENTINEL_STACK}\n    at Object.testRun (/test/run.ts:10:20)\n    at processTicksAndRejections (node:internal/process/task_queues:95:5)`;

    const causeError = new Error(`${SENTINEL_CAUSE_MSG}\n    at SENTINEL_CAUSE_CALLER`);
    causeError.name = "CustomCauseError";
    (causeError as unknown as { code: string }).code = "ERR_CAUSE_CODE";
    (customError as unknown as { cause: unknown }).cause = causeError;

    vi.spyOn(auth, "handler").mockImplementationOnce(() => {
      throw customError;
    });

    const res = await app.request("http://localhost/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ email: "test@example.com", password: "pwd" }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toStrictEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
    });

    const reqHeaderId = res.headers.get("x-request-id");
    expect(reqHeaderId).toBeTruthy();

    const allParsed = capturedLogs.map((l) => JSON.parse(l) as Record<string, unknown>);
    const errorLogs = allParsed.filter((l) => l.level === "error");
    expect(errorLogs).toHaveLength(1);

    const errorLog = errorLogs[0];
    expect(errorLog.requestId).toBe(reqHeaderId);
    expect(errorLog.errorName).toBe("CustomFaultInjectionError");
    expect(errorLog.errorCode).toBe("ERR_FAULT_INJECTED");
    expect(errorLog.causeName).toBe("CustomCauseError");
    expect(errorLog.causeCode).toBe("ERR_CAUSE_CODE");
    expect(errorLog.method).toBe("POST");
    expect(errorLog.path).toBe("/api/auth/sign-in/email");

    // Permitted fields check
    const permittedErrorKeys = new Set([
      "time",
      "level",
      "msg",
      "requestId",
      "method",
      "path",
      "errorName",
      "errorCode",
      "causeName",
      "causeCode",
      "stack",
    ]);
    for (const key of Object.keys(errorLog)) {
      expect(permittedErrorKeys.has(key)).toBe(true);
    }

    expect(typeof errorLog.stack).toBe("string");
    expect(errorLog.stack as string).toContain("at Object.testRun");
    expect(errorLog.stack as string).not.toContain(SENTINEL_STACK);

    const reqLogs = allParsed.filter((l) => l.requestId === reqHeaderId && l.level === "info");
    expect(reqLogs).toHaveLength(1);
    expect(reqLogs[0].status).toBe(500);

    // Verify sentinels never appear in ANY log line
    for (const logLine of capturedLogs) {
      expect(logLine).not.toContain(SENTINEL_ERR_MSG);
      expect(logLine).not.toContain(SENTINEL_STACK);
      expect(logLine).not.toContain(SENTINEL_CAUSE_MSG);
    }
  });

  it("L5: ignores client-provided X-Request-Id and generates server UUID", async () => {
    const clientProvidedId = "client-custom-untrusted-id-9999";
    const res = await app.request("http://localhost/api/auth/get-session", {
      method: "GET",
      headers: {
        "x-request-id": clientProvidedId,
      },
    });

    const serverReqId = res.headers.get("x-request-id");
    expect(serverReqId).toBeTruthy();
    expect(serverReqId).not.toBe(clientProvidedId);
    expect(serverReqId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    const allParsed = capturedLogs.map((l) => JSON.parse(l) as Record<string, unknown>);
    const matchedLog = allParsed.find((l) => l.requestId === serverReqId);
    expect(matchedLog).toBeDefined();

    for (const logLine of capturedLogs) {
      expect(logLine).not.toContain(clientProvidedId);
    }
  });

  it("L6: /api/auth/get-session response includes X-Request-Id matching its request log", async () => {
    const res = await app.request("http://localhost/api/auth/get-session", {
      method: "GET",
    });

    const reqId = res.headers.get("x-request-id");
    expect(reqId).toBeTruthy();

    expect(capturedLogs).toHaveLength(1);
    const allParsed = capturedLogs.map((l) => JSON.parse(l) as Record<string, unknown>);
    const matchedLog = allParsed.find((l) => l.requestId === reqId);
    expect(matchedLog).toBeDefined();
    expect(matchedLog?.path).toBe("/api/auth/get-session");
  });

  it("L7: GET /doc produces no logs under default level, and appears under debug level", async () => {
    // 1. Default level (info)
    capturedLogs = [];
    setLogLevel("info");
    const resDefault = await app.request("http://localhost/doc");
    expect(resDefault.status).toBe(200);

    const docLogsDefault = capturedLogs
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((l) => l.path === "/doc");
    expect(docLogsDefault).toHaveLength(0);

    // 2. Debug level
    capturedLogs = [];
    setLogLevel("debug");
    const resDebug = await app.request("http://localhost/doc");
    expect(resDebug.status).toBe(200);

    const docLogsDebug = capturedLogs
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((l) => l.path === "/doc");
    expect(docLogsDebug).toHaveLength(1);
    expect(docLogsDebug[0].level).toBe("debug");
    expect(docLogsDebug[0].path).toBe("/doc");
  });

  it("L8: auth.handler throwing Error with invalid identifiers omits unsafe fields", async () => {
    // 1. First error: name & code contain spaces and sentinels, cause.code is a number
    const errWithSpaces = new Error("SENTINEL_MSG_SPACES");
    errWithSpaces.name = "Invalid Name SENTINEL_ERR_NAME_888";
    (errWithSpaces as unknown as { code: string }).code = "INVALID CODE SENTINEL_ERR_CODE_888";
    const causeWithNumber = new Error("SENTINEL_CAUSE_MSG_SPACES");
    causeWithNumber.name = "Invalid Cause SENTINEL_CAUSE_NAME_888";
    (causeWithNumber as unknown as { code: number }).code = 12345;
    (errWithSpaces as unknown as { cause: unknown }).cause = causeWithNumber;

    vi.spyOn(auth, "handler").mockImplementationOnce(() => {
      throw errWithSpaces;
    });

    const res1 = await app.request("http://localhost/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ email: "test@example.com", password: "pwd" }),
    });

    expect(res1.status).toBe(500);
    const body1 = await res1.json();
    expect(body1).toStrictEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
    });

    const allParsed1 = capturedLogs.map((l) => JSON.parse(l) as Record<string, unknown>);
    const errorLogs1 = allParsed1.filter((l) => l.level === "error");
    expect(errorLogs1).toHaveLength(1);
    const errorLog1 = errorLogs1[0];
    expect(errorLog1.errorName).toBeUndefined();
    expect(errorLog1.errorCode).toBeUndefined();
    expect(errorLog1.causeName).toBeUndefined();
    expect(errorLog1.causeCode).toBeUndefined();

    // 2. Second error: code length 65 (> 64)
    const errLongCode = new Error("SENTINEL_MSG_LONG");
    errLongCode.name = "ValidName";
    (errLongCode as unknown as { code: string }).code = "A".repeat(65);

    vi.spyOn(auth, "handler").mockImplementationOnce(() => {
      throw errLongCode;
    });

    const res2 = await app.request("http://localhost/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ email: "test@example.com", password: "pwd" }),
    });

    expect(res2.status).toBe(500);
    const body2 = await res2.json();
    expect(body2).toStrictEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
    });

    const allParsed2 = capturedLogs.map((l) => JSON.parse(l) as Record<string, unknown>);
    const errorLogs2 = allParsed2.filter((l) => l.level === "error");
    expect(errorLogs2).toHaveLength(2);
    const errorLog2 = errorLogs2[1];
    expect(errorLog2.errorName).toBe("ValidName");
    expect(errorLog2.errorCode).toBeUndefined();

    // Verify sentinels never appear in any captured log line
    for (const logLine of capturedLogs) {
      expect(logLine).not.toContain("SENTINEL_ERR_NAME_888");
      expect(logLine).not.toContain("SENTINEL_ERR_CODE_888");
      expect(logLine).not.toContain("SENTINEL_CAUSE_NAME_888");
      expect(logLine).not.toContain("SENTINEL_MSG_SPACES");
      expect(logLine).not.toContain("SENTINEL_CAUSE_MSG_SPACES");
      expect(logLine).not.toContain("SENTINEL_MSG_LONG");
    }
  });

  it("L9: Better Auth database failure does not leak SQL text, params, or tokens", async () => {
    const SENTINEL_SQL_TEXT = "SENTINEL_SQL_TEXT_333";
    const SENTINEL_PARAM_TOKEN = "SENTINEL_PARAM_TOKEN_111";
    const SENTINEL_PWD = "SENTINEL_PWD_222";
    const SENTINEL_CONTROL = "SENTINEL_CONTROL_XYZ";

    const capturedOutputs: string[] = [];
    const pushOutput = (...args: unknown[]) => {
      capturedOutputs.push(util.format(...args));
    };

    const spyLog = vi.spyOn(console, "log").mockImplementation(pushOutput);
    const spyInfo = vi.spyOn(console, "info").mockImplementation(pushOutput);
    const spyWarn = vi.spyOn(console, "warn").mockImplementation(pushOutput);
    const spyError = vi.spyOn(console, "error").mockImplementation(pushOutput);
    const spyDebug = vi.spyOn(console, "debug").mockImplementation(pushOutput);

    const spyStdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      capturedOutputs.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    });
    const spyStderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      capturedOutputs.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    });

    setLogSink((line) => {
      capturedLogs.push(line);
      capturedOutputs.push(line);
    });

    try {
      // Positive control
      console.error(SENTINEL_CONTROL);
      expect(capturedOutputs.some((o) => o.includes(SENTINEL_CONTROL))).toBe(true);

      // Construct realistic DrizzleQueryError
      class DrizzleQueryError extends Error {
        query: string;
        params: unknown[];
        constructor(query: string, params: unknown[], cause?: unknown) {
          super(`Failed query: ${query}\nparams: ${String(params)}`);
          this.name = "DrizzleQueryError";
          this.query = query;
          this.params = params;
          if (cause) this.cause = cause;
        }
      }

      vi.spyOn(db, "select").mockImplementation(() => {
        throw new DrizzleQueryError(`SELECT * FROM session WHERE token = '${SENTINEL_SQL_TEXT}'`, [
          SENTINEL_PARAM_TOKEN,
        ]);
      });

      // Snapshot before get-session
      const snapshotBeforeGetSession = capturedLogs.length;

      // 1. GET /api/auth/get-session with valid session Cookie
      const getSessionRes = await app.request("http://localhost/api/auth/get-session", {
        method: "GET",
        headers: {
          cookie: ownerCookie,
        },
      });
      expect(getSessionRes.status).toBe(500);

      // Assert get-session new logs: at least one level=error log
      const snapshotAfterGetSession = capturedLogs.length;
      const getSessionNewLogs = capturedLogs
        .slice(snapshotBeforeGetSession, snapshotAfterGetSession)
        .map((l) => JSON.parse(l) as Record<string, unknown>);
      const getSessionErrorLogs = getSessionNewLogs.filter((l) => l.level === "error");
      expect(getSessionErrorLogs.length).toBeGreaterThanOrEqual(1);

      // Extract session token from ownerCookie
      const tokenMatch = ownerCookie.match(/better-auth\.session_token=([^;]+)/);
      const sessionTokenValue = tokenMatch ? tokenMatch[1] : ownerCookie;

      // Snapshot before sign-in
      const snapshotBeforeSignIn = capturedLogs.length;

      // 2. POST /api/auth/sign-in/email with sentinel password
      const signInRes = await app.request("http://localhost/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          email: "logging-owner@example.com",
          password: SENTINEL_PWD,
        }),
      });
      expect(signInRes.status).toBe(500);
      let signInBody: unknown;
      try {
        signInBody = await signInRes.json();
      } catch {
        signInBody = await signInRes.text();
      }
      expect(signInBody).toStrictEqual({
        error: {
          code: "INTERNAL_ERROR",
          message: "Internal server error",
        },
      });
      const signInReqHeaderId = signInRes.headers.get("x-request-id");
      expect(signInReqHeaderId).toBeTruthy();

      // Assert sign-in new logs: exactly one error log with msg === "Internal server error" matching X-Request-Id
      const snapshotAfterSignIn = capturedLogs.length;
      const signInNewLogs = capturedLogs
        .slice(snapshotBeforeSignIn, snapshotAfterSignIn)
        .map((l) => JSON.parse(l) as Record<string, unknown>);
      const signInInternalErrorLogs = signInNewLogs.filter(
        (l) => l.level === "error" && l.msg === "Internal server error",
      );
      expect(signInInternalErrorLogs).toHaveLength(1);
      expect(signInInternalErrorLogs[0].requestId).toBe(signInReqHeaderId);

      // Assertions:
      // Sentinels and session token value MUST NOT appear in any captured outputs (except control sentinel)
      const leakageOutputs = capturedOutputs.filter((o) => !o.includes(SENTINEL_CONTROL));
      for (const output of leakageOutputs) {
        expect(output).not.toContain(SENTINEL_SQL_TEXT);
        expect(output).not.toContain(SENTINEL_PARAM_TOKEN);
        expect(output).not.toContain(SENTINEL_PWD);
        expect(output).not.toContain(sessionTokenValue);
      }

      // Verify permitted fields whitelist across all error logs
      const allParsed = capturedLogs.map((l) => JSON.parse(l) as Record<string, unknown>);
      const allErrorLogs = allParsed.filter((l) => l.level === "error");
      expect(allErrorLogs.length).toBeGreaterThanOrEqual(2);
      const permittedKeys = new Set([
        "time",
        "level",
        "msg",
        "requestId",
        "method",
        "path",
        "errorName",
        "errorCode",
        "causeName",
        "causeCode",
        "stack",
        "baMessage",
      ]);

      for (const errLog of allErrorLogs) {
        for (const key of Object.keys(errLog)) {
          expect(permittedKeys.has(key)).toBe(true);
        }
      }
    } finally {
      spyLog.mockRestore();
      spyInfo.mockRestore();
      spyWarn.mockRestore();
      spyError.mockRestore();
      spyDebug.mockRestore();
      spyStdout.mockRestore();
      spyStderr.mockRestore();
      vi.restoreAllMocks();
    }
  });
});
