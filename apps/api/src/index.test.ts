import { beforeAll, describe, expect, it } from "vite-plus/test";

let app: typeof import("./index.ts").app;

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5433/event_registration";
  process.env.BETTER_AUTH_SECRET ??= "test-secret-for-unit-tests-only-123456";
  process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
  process.env.TRUSTED_ORIGINS ??= "http://localhost:3000";
  process.env.LOG_LEVEL ??= "info";
  process.env.NODE_ENV ??= "test";

  const mod = await import("./index.ts");
  app = mod.app;
});

describe("OpenAPI health route and /doc endpoint", () => {
  it("returns 200 and echoed payload for valid GET /api/health query", async () => {
    const res = await app.request("http://localhost/api/health?echo=ping");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      echo: "ping",
    });
  });

  it("returns 400 when required echo query parameter is missing", async () => {
    const res = await app.request("http://localhost/api/health");
    expect(res.status).toBe(400);
  });

  it("serves OpenAPI 3.0.0 specification at GET /doc including /api/health", async () => {
    const res = await app.request("http://localhost/doc");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(doc.openapi).toBe("3.0.0");
    expect(doc.paths["/api/health"]).toBeDefined();
  });
});
