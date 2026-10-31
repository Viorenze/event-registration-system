import type { Context } from "hono";
import { DomainError } from "./registrations.ts";

export interface HttpErrorResponse {
  status: 400 | 404 | 409 | 500;
  body: {
    error: {
      code: string;
      message: string;
    };
  };
}

export function mapDomainError(
  err: unknown,
  defaultMessage = "Internal server error",
): HttpErrorResponse {
  if (err instanceof DomainError) {
    if (err.code === "NOT_FOUND") {
      return {
        status: 404,
        body: { error: { code: "NOT_FOUND", message: err.message } },
      };
    }
    if (
      err.code === "REGISTRATION_CLOSED" ||
      err.code === "EVENT_STARTED" ||
      err.code === "EVENT_CANCELLED" ||
      err.code === "CAPACITY_BELOW_CONFIRMED"
    ) {
      return {
        status: 409,
        body: { error: { code: err.code, message: err.message } },
      };
    }
    if (err.code === "VALIDATION") {
      return {
        status: 400,
        body: { error: { code: "VALIDATION", message: err.message } },
      };
    }
  }

  return {
    status: 500,
    body: { error: { code: "INTERNAL_ERROR", message: defaultMessage } },
  };
}

export function respondWithError(
  c: Context,
  err: unknown,
  defaultMessage = "Internal server error",
) {
  const errRes = mapDomainError(err, defaultMessage);
  switch (errRes.status) {
    case 400:
      return c.json(errRes.body, 400);
    case 404:
      return c.json(errRes.body, 404);
    case 409:
      return c.json(errRes.body, 409);
    default:
      return c.json(errRes.body, 500);
  }
}
