import { serve } from "@hono/node-server";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { auth } from "./auth.ts";
import { parseEnv } from "./env.ts";

export const env = parseEnv(process.env);

const healthRoute = createRoute({
  method: "get",
  path: "/api/health",
  request: {
    query: z.object({
      echo: z.string().min(1),
    }),
  },
  responses: {
    200: {
      description: "Health check response",
      content: {
        "application/json": {
          schema: z.object({
            status: z.literal("ok"),
            echo: z.string(),
          }),
        },
      },
    },
  },
});

export const app = new OpenAPIHono()
  .openapi(healthRoute, (c) => {
    const { echo } = c.req.valid("query");
    return c.json({ status: "ok" as const, echo }, 200);
  })
  .doc("/doc", {
    openapi: "3.0.0",
    info: {
      title: "Event Registration API",
      version: "0.1.0",
    },
  })
  .get("/", (c) => {
    return c.json({ status: "ok" });
  })
  .on(["POST", "GET"], "/api/auth/*", (c) => {
    return auth.handler(c.req.raw);
  });

export type AppType = typeof app;

if (import.meta.main) {
  const port = Number(process.env.API_PORT ?? 3001);
  serve({
    fetch: app.fetch,
    hostname: "127.0.0.1",
    port,
  });
}
