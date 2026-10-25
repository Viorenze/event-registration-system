import { serve } from "@hono/node-server";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { asc, eq, events, member, sql, user } from "@event-system/db";
import { auth, db } from "./auth.ts";
import { errorResponseSchema, orgAuthMiddleware, requireRole } from "./auth-middleware.ts";
import { parseEnv } from "./env.ts";

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
          schema: z.array(eventResponseSchema),
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
      }));

      return c.json(serialized, 200);
    } catch {
      return c.json({ error: { code: "INTERNAL_ERROR", message: "Failed to fetch events" } }, 500);
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
