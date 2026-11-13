import crypto from "node:crypto";
import type { MiddlewareHandler } from "hono";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogSink = (line: string) => void;

const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const defaultSink: LogSink = (line: string) => {
  process.stdout.write(`${line}\n`);
};

let currentSink: LogSink = defaultSink;
let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

export function setLogSink(sink: LogSink): void {
  currentSink = sink;
}

export function resetLogSink(): void {
  currentSink = defaultSink;
}

function emitLog(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  if (LOG_LEVEL_WEIGHT[level] < LOG_LEVEL_WEIGHT[currentLevel]) {
    return;
  }

  const time = new Date().toISOString();
  // Ensure time, level, msg cannot be overwritten by fields
  const logEntry = {
    ...fields,
    time,
    level,
    msg,
  };

  currentSink(JSON.stringify(logEntry));
}

export const logger = {
  debug(msg: string, fields?: Record<string, unknown>): void {
    emitLog("debug", msg, fields);
  },
  info(msg: string, fields?: Record<string, unknown>): void {
    emitLog("info", msg, fields);
  },
  warn(msg: string, fields?: Record<string, unknown>): void {
    emitLog("warn", msg, fields);
  },
  error(msg: string, fields?: Record<string, unknown>): void {
    emitLog("error", msg, fields);
  },
};

export const requestLoggerMiddleware: MiddlewareHandler = async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set("requestId", requestId);
  const start = performance.now();

  await next();

  const durationMs = Math.round(performance.now() - start);

  if (c.res) {
    try {
      c.res.headers.set("X-Request-Id", requestId);
    } catch {
      const body = [101, 204, 205, 304].includes(c.res.status) ? null : c.res.body;
      c.res = new Response(body, {
        status: c.res.status,
        statusText: c.res.statusText,
        headers: new Headers(c.res.headers),
      });
      c.res.headers.set("X-Request-Id", requestId);
    }
  }

  const user = c.get("user") as { id?: string } | undefined;
  const userId = typeof user?.id === "string" && user.id.length > 0 ? user.id : null;
  const rawOrgId = c.get("orgId");
  const orgId = typeof rawOrgId === "string" && rawOrgId.length > 0 ? rawOrgId : null;
  const status = c.res ? c.res.status : 500;
  const method = c.req.method;
  const path = c.req.path;

  const logFields: Record<string, unknown> = {
    requestId,
    method,
    path,
    status,
    durationMs,
    userId,
    orgId,
  };

  if (path === "/doc") {
    logger.debug("request", logFields);
  } else {
    logger.info("request", logFields);
  }
};

export const SAFE_LOG_IDENTIFIER_REGEX = /^[A-Za-z0-9_.:-]{1,64}$/;
export const SAFE_BA_MESSAGE_REGEX = /^[A-Za-z0-9_ .:-]{1,120}$/;

export function summarizeError(err: unknown): Record<string, unknown> {
  const fields: Record<string, unknown> = {};

  if (
    err &&
    typeof err === "object" &&
    "name" in err &&
    typeof (err as { name: unknown }).name === "string"
  ) {
    const errorName = (err as { name: string }).name;
    if (SAFE_LOG_IDENTIFIER_REGEX.test(errorName)) {
      fields.errorName = errorName;
    }
  }

  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string"
  ) {
    const errorCode = (err as { code: string }).code;
    if (SAFE_LOG_IDENTIFIER_REGEX.test(errorCode)) {
      fields.errorCode = errorCode;
    }
  }

  if (err && typeof err === "object" && "cause" in err) {
    const cause = (err as { cause: unknown }).cause;
    if (cause && typeof cause === "object") {
      if ("name" in cause && typeof (cause as { name: unknown }).name === "string") {
        const causeName = (cause as { name: string }).name;
        if (SAFE_LOG_IDENTIFIER_REGEX.test(causeName)) {
          fields.causeName = causeName;
        }
      }
      if ("code" in cause && typeof (cause as { code: unknown }).code === "string") {
        const causeCode = (cause as { code: string }).code;
        if (SAFE_LOG_IDENTIFIER_REGEX.test(causeCode)) {
          fields.causeCode = causeCode;
        }
      }
    }
  }

  if (err && typeof (err as { stack?: unknown }).stack === "string") {
    let rawStack = (err as { stack: string }).stack;
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      const normalizedMessage = message.replaceAll("\r\n", "\n");
      rawStack = rawStack.replaceAll("\r\n", "\n").replaceAll(normalizedMessage, "");
    }
    const stackLines = rawStack
      .split(/\r?\n/)
      .filter((line) => /^\s+at /.test(line))
      .slice(0, 15);
    if (stackLines.length > 0) {
      fields.stack = stackLines.join("\n");
    }
  }

  return fields;
}

export function forwardBetterAuthLog(level: string, message: string, ...args: unknown[]): void {
  const mappedLevel: LogLevel =
    level === "error" ? "error" : level === "warn" ? "warn" : level === "debug" ? "debug" : "info";

  const baMessage =
    typeof message === "string" && SAFE_BA_MESSAGE_REGEX.test(message) ? message : "withheld";

  const fields: Record<string, unknown> = {
    baMessage,
  };

  const firstObj = args.find((arg) => arg !== null && typeof arg === "object");
  if (firstObj) {
    const errorFields = summarizeError(firstObj);
    Object.assign(fields, errorFields);
  }

  logger[mappedLevel]("better-auth", fields);
}
