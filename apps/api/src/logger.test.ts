import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  forwardBetterAuthLog,
  getLogLevel,
  logger,
  resetLogSink,
  setLogLevel,
  setLogSink,
  summarizeError,
} from "./logger.ts";

describe("L1 Logger Unit Tests", () => {
  let logs: string[] = [];

  beforeEach(() => {
    logs = [];
    setLogSink((line) => {
      logs.push(line);
    });
    setLogLevel("info");
  });

  afterEach(() => {
    resetLogSink();
    setLogLevel("info");
  });

  it("filters logs based on log level hierarchy", () => {
    // Current level: info
    logger.debug("debug message 1");
    logger.info("info message 1");
    logger.warn("warn message 1");
    logger.error("error message 1");

    expect(logs).toHaveLength(3);
    const parsedLevels1 = logs.map((l) => (JSON.parse(l) as { level: string }).level);
    expect(parsedLevels1).toEqual(["info", "warn", "error"]);

    // Set level: warn
    logs = [];
    setLogLevel("warn");
    expect(getLogLevel()).toBe("warn");
    logger.debug("debug message 2");
    logger.info("info message 2");
    logger.warn("warn message 2");
    logger.error("error message 2");

    expect(logs).toHaveLength(2);
    const parsedLevels2 = logs.map((l) => (JSON.parse(l) as { level: string }).level);
    expect(parsedLevels2).toEqual(["warn", "error"]);

    // Set level: error
    logs = [];
    setLogLevel("error");
    logger.debug("debug message 3");
    logger.info("info message 3");
    logger.warn("warn message 3");
    logger.error("error message 3");

    expect(logs).toHaveLength(1);
    const parsedLevels3 = logs.map((l) => (JSON.parse(l) as { level: string }).level);
    expect(parsedLevels3).toEqual(["error"]);

    // Set level: debug
    logs = [];
    setLogLevel("debug");
    logger.debug("debug message 4");
    logger.info("info message 4");
    logger.warn("warn message 4");
    logger.error("error message 4");

    expect(logs).toHaveLength(4);
    const parsedLevels4 = logs.map((l) => (JSON.parse(l) as { level: string }).level);
    expect(parsedLevels4).toEqual(["debug", "info", "warn", "error"]);
  });

  it("formats every log record as a single-line valid JSON with time, level, msg", () => {
    logger.info("test json formatting", { extraKey: "extraValue" });

    expect(logs).toHaveLength(1);
    const line = logs[0];

    // Must be a single line (no raw newlines)
    expect(line).not.toContain("\n");
    expect(line).not.toContain("\r");

    const parsed = JSON.parse(line) as {
      time: string;
      level: string;
      msg: string;
      extraKey: string;
    };
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("test json formatting");
    expect(parsed.extraKey).toBe("extraValue");

    // Validate ISO timestamp format
    expect(parsed.time).toBeDefined();
    expect(new Date(parsed.time).toISOString()).toBe(parsed.time);
  });

  it("prevents fields from overriding time, level, and msg", () => {
    logger.info("real message", {
      time: "spoofed_time",
      level: "spoofed_level",
      msg: "spoofed_msg",
      safeField: "safeValue",
    });

    expect(logs).toHaveLength(1);
    const parsed = JSON.parse(logs[0]) as {
      time: string;
      level: string;
      msg: string;
      safeField: string;
    };

    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("real message");
    expect(parsed.time).not.toBe("spoofed_time");
    expect(new Date(parsed.time).toISOString()).toBe(parsed.time);
    expect(parsed.safeField).toBe("safeValue");
  });
});

describe("L10 forwardBetterAuthLog and summarizeError Unit Tests", () => {
  let logs: string[] = [];

  beforeEach(() => {
    logs = [];
    setLogSink((line) => {
      logs.push(line);
    });
    setLogLevel("debug");
  });

  afterEach(() => {
    resetLogSink();
    setLogLevel("info");
  });

  it("summarizeError purges message, extracts stack up to 15 lines, and sanitizes identifiers", () => {
    const err = new Error("SENTINEL_ERR_MSG_SECRET");
    err.name = "CustomError_1";
    (err as unknown as { code: string }).code = "CODE_1";
    err.stack = `Error: SENTINEL_ERR_MSG_SECRET\n    at testFunction (/app/test.ts:1:1)\n    at Object.run (/app/run.ts:2:2)`;

    const cause = new Error("CAUSE_SECRET");
    cause.name = "CauseError_1";
    (cause as unknown as { code: string }).code = "CAUSE_CODE_1";
    (err as unknown as { cause: unknown }).cause = cause;

    const summary = summarizeError(err);
    expect(summary.errorName).toBe("CustomError_1");
    expect(summary.errorCode).toBe("CODE_1");
    expect(summary.causeName).toBe("CauseError_1");
    expect(summary.causeCode).toBe("CAUSE_CODE_1");
    expect(typeof summary.stack).toBe("string");
    expect(summary.stack as string).toContain("at testFunction");
    expect(summary.stack as string).not.toContain("SENTINEL_ERR_MSG_SECRET");
    expect((summary as Record<string, unknown>).message).toBeUndefined();

    // Test illegal identifier omitting (spaces, special chars, length > 64, number code)
    const illegalErr = new Error("msg");
    illegalErr.name = "Illegal Name With Spaces";
    (illegalErr as unknown as { code: string }).code = "X".repeat(65);
    (illegalErr as unknown as { cause: unknown }).cause = {
      name: "Bad!Chars*Here",
      code: 12345,
    };
    const illegalSummary = summarizeError(illegalErr);
    expect(illegalSummary.errorName).toBeUndefined();
    expect(illegalSummary.errorCode).toBeUndefined();
    expect(illegalSummary.causeName).toBeUndefined();
    expect(illegalSummary.causeCode).toBeUndefined();
  });

  it("forwardBetterAuthLog writes 'withheld' when message contains email or URL", () => {
    forwardBetterAuthLog("info", "User registered with a@b.com successfully");
    forwardBetterAuthLog("info", "Redirecting to https://example.com/callback");
    forwardBetterAuthLog("info", "SAFE_EVENT_MESSAGE: user.created");

    expect(logs).toHaveLength(3);
    const p1 = JSON.parse(logs[0]) as { baMessage: string };
    const p2 = JSON.parse(logs[1]) as { baMessage: string };
    const p3 = JSON.parse(logs[2]) as { baMessage: string };

    expect(p1.baMessage).toBe("withheld");
    expect(p2.baMessage).toBe("withheld");
    expect(p3.baMessage).toBe("SAFE_EVENT_MESSAGE: user.created");
  });

  it("forwardBetterAuthLog prevents Error message and raw args from leaking", () => {
    const sensitiveErr = new Error("SENTINEL_SENSITIVE_DB_PARAM_999");
    sensitiveErr.name = "DatabaseError";
    sensitiveErr.stack = `DatabaseError: SENTINEL_SENSITIVE_DB_PARAM_999\n    at executeQuery (/db/query.ts:10:5)`;

    const rawObject = { password: "RAW_SECRET_PASSWORD_123", apiKey: "SECRET_KEY_456" };

    forwardBetterAuthLog("error", "Database failure occurred", sensitiveErr, rawObject);

    expect(logs).toHaveLength(1);
    const line = logs[0];
    expect(line).not.toContain("SENTINEL_SENSITIVE_DB_PARAM_999");
    expect(line).not.toContain("RAW_SECRET_PASSWORD_123");
    expect(line).not.toContain("SECRET_KEY_456");

    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.level).toBe("error");
    expect(parsed.baMessage).toBe("Database failure occurred");
    expect(parsed.errorName).toBe("DatabaseError");
    expect(typeof parsed.stack).toBe("string");
    expect(parsed.stack as string).toContain("at executeQuery");
    // Verify non-Error object is NOT serialized wholesale
    expect(parsed.password).toBeUndefined();
    expect(parsed.apiKey).toBeUndefined();
  });

  it("forwardBetterAuthLog maps log levels correctly: success/info -> info, warn -> warn, error -> error, debug -> debug", () => {
    forwardBetterAuthLog("success" as any, "msg_success");
    forwardBetterAuthLog("info", "msg_info");
    forwardBetterAuthLog("warn", "msg_warn");
    forwardBetterAuthLog("error", "msg_error");
    forwardBetterAuthLog("debug", "msg_debug");

    expect(logs).toHaveLength(5);
    const parsedLevels = logs.map((l) => (JSON.parse(l) as { level: string }).level);
    expect(parsedLevels).toEqual(["info", "info", "warn", "error", "debug"]);
  });
});
