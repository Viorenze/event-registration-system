import { serve } from "@hono/node-server";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { asc, eq, events, member, sql, user } from "@event-system/db";
import { auth, db } from "./auth.ts";
import { errorResponseSchema, orgAuthMiddleware, requireRole } from "./auth-middleware.ts";
import { parseEnv } from "./env.ts";
import { cancel, cancelEvent, register, updateEvent } from "./registrations.ts";
import { respondWithError } from "./http-errors.ts";

export const env = parseEnv(process.env);

export class DomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainValidationError";
  }
}

export const eventResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  startsAt: z.string(),
  registrationDeadline: z.string(),
  capacity: z.number(),
  status: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const eventListItemResponseSchema = eventResponseSchema.extend({
  confirmedCount: z.number().int(),
  waitlistedCount: z.number().int(),
});

export const registrationResponseSchema = z.object({
  id: z.string().uuid(),
  eventId: z.string().uuid(),
  userId: z.string(),
  status: z.string(),
  createdAt: z.string(),
});

const getOrgMembersRoute = createRoute({
  method: "get",
  path: "/api/orgs/{orgId}/members",
  middleware: [requireRole("member")] as const,
  request: {
    params: z.object({
      orgId: z.string(),
    }),
  },
  responses: {
    200: {
      description: "List of organization members",
      content: {
        "application/json": {
          schema: z.array(
            z.object({
              userId: z.string(),
              name: z.string(),
              role: z.string(),
            }),
          ),
        },
      },
    },
    401: {
      description: "Unauthenticated",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    403: {
      description: "Forbidden",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal Server Error",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

const createEventRoute = createRoute({
  method: "post",
  path: "/api/orgs/{orgId}/events",
  middleware: [requireRole("admin")] as const,
  request: {
    params: z.object({
      orgId: z.string(),
    }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            title: z.string().trim().min(1, "title is required").max(120, "title too long"),
            description: z.string().max(2000, "description too long").nullable().optional(),
            startsAt: z.string().datetime({ offset: true, message: "Invalid startsAt datetime" }),
            registrationDeadline: z.string().datetime({
              offset: true,
              message: "Invalid registrationDeadline datetime",
            }),
            capacity: z
              .number()
              .int("capacity must be an integer")
              .min(1, "capacity must be at least 1")
              .max(1000, "capacity cannot exceed 1000"),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "Event created successfully",
      content: {
        "application/json": {
          schema: eventResponseSchema,
        },
      },
    },
    400: {
      description: "Validation error",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    401: {
      description: "Unauthenticated",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    403: {
      description: "Forbidden",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal Server Error",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

const getOrgEventsRoute = createRoute({
  method: "get",
  path: "/api/orgs/{orgId}/events",
  middleware: [requireRole("member")] as const,
  request: {
    params: z.object({
      orgId: z.string(),
    }),
    query: z.object({
      limit: z.coerce
        .number()
        .int("limit must be an integer")
        .min(1, "limit must be at least 1")
        .max(100, "limit cannot exceed 100")
        .default(20),
      offset: z.coerce
        .number()
        .int("offset must be an integer")
        .min(0, "offset cannot be negative")
        .default(0),
    }),
  },
  responses: {
    200: {
      description: "List of organization events",
      content: {
        "application/json": {
          schema: z.array(eventListItemResponseSchema),
        },
      },
    },
    400: {
      description: "Validation error",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    401: {
      description: "Unauthenticated",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    403: {
      description: "Forbidden",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal Server Error",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

const createRegistrationRoute = createRoute({
  method: "post",
  path: "/api/orgs/{orgId}/events/{eventId}/registrations",
  middleware: [requireRole("member")] as const,
  request: {
    params: z.object({
      orgId: z.string(),
      eventId: z.string().uuid("Invalid eventId format"),
    }),
  },
  responses: {
    200: {
      description: "Existing active registration returned (idempotent)",
      content: {
        "application/json": {
          schema: registrationResponseSchema,
        },
      },
    },
    201: {
      description: "Registration created successfully",
      content: {
        "application/json": {
          schema: registrationResponseSchema,
        },
      },
    },
    400: {
      description: "Validation error",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    401: {
      description: "Unauthenticated",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    403: {
      description: "Forbidden",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    404: {
      description: "Not Found",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    409: {
      description: "Conflict / Business Rule Rejected",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal Server Error",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

const deleteRegistrationMeRoute = createRoute({
  method: "delete",
  path: "/api/orgs/{orgId}/events/{eventId}/registrations/me",
  middleware: [requireRole("member")] as const,
  request: {
    params: z.object({
      orgId: z.string(),
      eventId: z.string().uuid("Invalid eventId format"),
    }),
  },
  responses: {
    204: {
      description: "Registration cancelled or idempotent noop",
    },
    400: {
      description: "Validation error",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    401: {
      description: "Unauthenticated",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    403: {
      description: "Forbidden",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    404: {
      description: "Not Found",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    409: {
      description: "Conflict / Business Rule Rejected",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal Server Error",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

const deleteRegistrationRoute = createRoute({
  method: "delete",
  path: "/api/orgs/{orgId}/events/{eventId}/registrations/{registrationId}",
  middleware: [requireRole("admin")] as const,
  request: {
    params: z.object({
      orgId: z.string(),
      eventId: z.string().uuid("Invalid eventId format"),
      registrationId: z.string().uuid("Invalid registrationId format"),
    }),
  },
  responses: {
    204: {
      description: "Registration cancelled or idempotent noop",
    },
    400: {
      description: "Validation error",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    401: {
      description: "Unauthenticated",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    403: {
      description: "Forbidden",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    404: {
      description: "Not Found",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    409: {
      description: "Conflict / Business Rule Rejected",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal Server Error",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

const updateEventRoute = createRoute({
  method: "patch",
  path: "/api/orgs/{orgId}/events/{eventId}",
  middleware: [requireRole("admin")] as const,
  request: {
    params: z.object({
      orgId: z.string(),
      eventId: z.string().uuid("Invalid eventId format"),
    }),
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              title: z
                .string()
                .trim()
                .min(1, "title is required")
                .max(120, "title too long")
                .optional(),
              description: z.string().max(2000, "description too long").nullable().optional(),
              capacity: z
                .number()
                .int("capacity must be an integer")
                .min(1, "capacity must be at least 1")
                .max(1000, "capacity cannot exceed 1000")
                .optional(),
            })
            .strict()
            .refine((data) => Object.keys(data).length > 0, {
              message: "At least one field is required",
            }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Event updated successfully",
      content: {
        "application/json": {
          schema: eventResponseSchema,
        },
      },
    },
    400: {
      description: "Validation error",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    401: {
      description: "Unauthenticated",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    403: {
      description: "Forbidden",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    404: {
      description: "Not Found",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    409: {
      description: "Conflict / Business Rule Rejected",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal Server Error",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

const cancelEventRoute = createRoute({
  method: "post",
  path: "/api/orgs/{orgId}/events/{eventId}/cancel",
  middleware: [requireRole("admin")] as const,
  request: {
    params: z.object({
      orgId: z.string(),
      eventId: z.string().uuid("Invalid eventId format"),
    }),
  },
  responses: {
    200: {
      description: "Event cancelled successfully",
      content: {
        "application/json": {
          schema: eventResponseSchema,
        },
      },
    },
    400: {
      description: "Validation error",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    401: {
      description: "Unauthenticated",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    403: {
      description: "Forbidden",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    404: {
      description: "Not Found",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    409: {
      description: "Conflict / Business Rule Rejected",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal Server Error",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
  },
});

const baseApp = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: {
            code: "VALIDATION",
            message: result.error.issues.map((e) => e.message).join("; "),
          },
        },
        400,
      );
    }
  },
});

baseApp.onError((_err, c) => {
  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
    },
    500,
  );
});

baseApp.use("/api/orgs/:orgId/*", orgAuthMiddleware);

export const app = baseApp
  .openapi(getOrgMembersRoute, async (c) => {
    const { orgId } = c.req.valid("param");
    try {
      const members = await db
        .select({
          userId: member.userId,
          name: user.name,
          role: member.role,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(eq(member.organizationId, orgId));

      return c.json(members, 200);
    } catch {
      return c.json({ error: { code: "INTERNAL_ERROR", message: "Failed to fetch members" } }, 500);
    }
  })
  .openapi(createEventRoute, async (c) => {
    const { orgId } = c.req.valid("param");
    const body = c.req.valid("json");
    const sessionUser = c.get("user") as { id: string };

    try {
      const startsAtDate = new Date(body.startsAt);
      const deadlineDate = new Date(body.registrationDeadline);

      const newEvent = await db.transaction(async (tx) => {
        const clockRes = await tx.execute<{ current_time: string | Date }>(
          sql`SELECT clock_timestamp() AS current_time`,
        );
        const dbNow = new Date(clockRes.rows[0].current_time);
        if (startsAtDate.getTime() <= dbNow.getTime()) {
          throw new DomainValidationError("Event startsAt must be in the future");
        }
        if (deadlineDate.getTime() > startsAtDate.getTime()) {
          throw new DomainValidationError("Registration deadline cannot be after start time");
        }

        const [inserted] = await tx
          .insert(events)
          .values({
            organizationId: orgId,
            title: body.title,
            description: body.description ?? null,
            startsAt: startsAtDate,
            registrationDeadline: deadlineDate,
            capacity: body.capacity,
            status: "open",
            createdBy: sessionUser.id,
          })
          .returning();

        return inserted;
      });

      return c.json(
        {
          ...newEvent,
          startsAt: newEvent.startsAt.toISOString(),
          registrationDeadline: newEvent.registrationDeadline.toISOString(),
          createdAt: newEvent.createdAt.toISOString(),
          updatedAt: newEvent.updatedAt.toISOString(),
        },
        201,
      );
    } catch (err) {
      if (err instanceof DomainValidationError) {
        return c.json({ error: { code: "VALIDATION", message: err.message } }, 400);
      }
      return c.json({ error: { code: "INTERNAL_ERROR", message: "Failed to create event" } }, 500);
    }
  })
  .openapi(getOrgEventsRoute, async (c) => {
    const { orgId } = c.req.valid("param");
    const { limit, offset } = c.req.valid("query");

    try {
      const confirmedCountSql = sql<number>`COALESCE((
        SELECT count(*)::int
        FROM "registrations"
        WHERE "registrations"."event_id" = "events"."id"
          AND "registrations"."organization_id" = "events"."organization_id"
          AND "registrations"."status" = 'confirmed'
      ), 0)`.as("confirmedCount");

      const waitlistedCountSql = sql<number>`COALESCE((
        SELECT count(*)::int
        FROM "registrations"
        WHERE "registrations"."event_id" = "events"."id"
          AND "registrations"."organization_id" = "events"."organization_id"
          AND "registrations"."status" = 'waitlisted'
      ), 0)`.as("waitlistedCount");

      const rows = await db
        .select({
          id: events.id,
          organizationId: events.organizationId,
          title: events.title,
          description: events.description,
          startsAt: events.startsAt,
          registrationDeadline: events.registrationDeadline,
          capacity: events.capacity,
          status: events.status,
          createdBy: events.createdBy,
          createdAt: events.createdAt,
          updatedAt: events.updatedAt,
          confirmedCount: confirmedCountSql,
          waitlistedCount: waitlistedCountSql,
        })
        .from(events)
        .where(eq(events.organizationId, orgId))
        .orderBy(asc(events.startsAt), asc(events.id))
        .limit(limit)
        .offset(offset);

      const serialized = rows.map((r) => ({
        ...r,
        startsAt: r.startsAt.toISOString(),
        registrationDeadline: r.registrationDeadline.toISOString(),
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        confirmedCount: Number(r.confirmedCount ?? 0),
        waitlistedCount: Number(r.waitlistedCount ?? 0),
      }));

      return c.json(serialized, 200);
    } catch {
      return c.json({ error: { code: "INTERNAL_ERROR", message: "Failed to fetch events" } }, 500);
    }
  })
  .openapi(createRegistrationRoute, async (c) => {
    const { orgId, eventId } = c.req.valid("param");
    const sessionUser = c.get("user") as { id: string };

    try {
      const { registration: reg, isCreated } = await register(db, orgId, eventId, sessionUser.id);

      const responseBody = {
        id: reg.id,
        eventId: reg.eventId,
        userId: reg.userId,
        status: reg.status,
        createdAt: reg.createdAt.toISOString(),
      };

      return c.json(responseBody, isCreated ? 201 : 200);
    } catch (err) {
      return respondWithError(c, err, "Failed to register for event");
    }
  })
  .openapi(deleteRegistrationMeRoute, async (c) => {
    const { orgId, eventId } = c.req.valid("param");
    const sessionUser = c.get("user") as { id: string };
    const memberRole = (c.get("memberRole") as string) ?? "member";

    try {
      await cancel(db, orgId, eventId, { me: true }, { userId: sessionUser.id, role: memberRole });
      return c.body(null, 204);
    } catch (err) {
      return respondWithError(c, err, "Failed to cancel registration");
    }
  })
  .openapi(deleteRegistrationRoute, async (c) => {
    const { orgId, eventId, registrationId } = c.req.valid("param");
    const sessionUser = c.get("user") as { id: string };
    const memberRole = (c.get("memberRole") as string) ?? "admin";

    try {
      await cancel(
        db,
        orgId,
        eventId,
        { registrationId },
        { userId: sessionUser.id, role: memberRole },
      );
      return c.body(null, 204);
    } catch (err) {
      return respondWithError(c, err, "Failed to cancel registration");
    }
  })
  .openapi(updateEventRoute, async (c) => {
    const { orgId, eventId } = c.req.valid("param");
    const body = c.req.valid("json");

    try {
      const updated = await updateEvent(db, orgId, eventId, body);
      return c.json(
        {
          ...updated,
          startsAt: updated.startsAt.toISOString(),
          registrationDeadline: updated.registrationDeadline.toISOString(),
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        },
        200,
      );
    } catch (err) {
      return respondWithError(c, err, "Failed to update event");
    }
  })
  .openapi(cancelEventRoute, async (c) => {
    const { orgId, eventId } = c.req.valid("param");

    try {
      const cancelled = await cancelEvent(db, orgId, eventId);
      return c.json(
        {
          ...cancelled,
          startsAt: cancelled.startsAt.toISOString(),
          registrationDeadline: cancelled.registrationDeadline.toISOString(),
          createdAt: cancelled.createdAt.toISOString(),
          updatedAt: cancelled.updatedAt.toISOString(),
        },
        200,
      );
    } catch (err) {
      return respondWithError(c, err, "Failed to cancel event");
    }
  })
  .doc("/doc", {
    openapi: "3.0.0",
    info: {
      title: "Event Registration API",
      version: "0.1.0",
    },
  })
  .on(["POST", "GET"], "/api/auth/*", (c) => {
    return auth.handler(c.req.raw);
  });

export type AppType = typeof app;

if (import.meta.main) {
  const port = Number(process.env.API_PORT ?? 3001);
  const hostname = process.env.API_HOST ?? "127.0.0.1";
  serve({
    fetch: app.fetch,
    hostname,
    port,
  });
}
