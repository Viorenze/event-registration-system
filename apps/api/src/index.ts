import { serve } from "@hono/node-server";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { eq, member, user } from "@event-system/db";
import { auth, db } from "./auth.ts";
import { errorResponseSchema, orgAuthMiddleware, requireRole } from "./auth-middleware.ts";
import { parseEnv } from "./env.ts";

export const env = parseEnv(process.env);

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

const baseApp = new OpenAPIHono();

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
