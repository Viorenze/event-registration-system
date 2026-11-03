import type { RouteEntry } from "../routes-table.ts";

export interface RouteFixtureContext {
  orgId: string;
  eventId?: string;
  registrationId?: string;
  overrideParams?: Record<string, string>;
}

export interface RouteFixtureResult {
  method: RouteEntry["method"];
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export type RouteFixtureMap = Record<
  string,
  (ctx: RouteFixtureContext) => {
    headers?: Record<string, string>;
    body?: unknown;
  }
>;

export const routeFixtureBuilders: RouteFixtureMap = {
  "GET /api/orgs/:orgId/members": () => ({}),
  "POST /api/orgs/:orgId/events": () => ({
    headers: { "content-type": "application/json" },
    body: {
      title: "Valid Fixture Event",
      description: "Valid description for isolation test",
      startsAt: new Date(Date.now() + 86400000 * 2).toISOString(),
      registrationDeadline: new Date(Date.now() + 86400000).toISOString(),
      capacity: 10,
    },
  }),
  "GET /api/orgs/:orgId/events": () => ({}),
  "POST /api/orgs/:orgId/events/:eventId/registrations": () => ({}),
  "DELETE /api/orgs/:orgId/events/:eventId/registrations/me": () => ({}),
  "DELETE /api/orgs/:orgId/events/:eventId/registrations/:registrationId": () => ({}),
  "PATCH /api/orgs/:orgId/events/:eventId": () => ({
    headers: { "content-type": "application/json" },
    body: {
      title: "Updated Title for Fixture",
      capacity: 20,
    },
  }),
  "POST /api/orgs/:orgId/events/:eventId/cancel": () => ({}),
};

export function getRouteFixture(route: RouteEntry, ctx: RouteFixtureContext): RouteFixtureResult {
  const routeKey = `${route.method} ${route.path}`;
  const builder = routeFixtureBuilders[routeKey];
  if (!builder) {
    throw new Error(
      `Route fixture missing for route: ${routeKey}. Every route in routesTable must have a registered fixture.`,
    );
  }

  const { headers, body } = builder(ctx);

  let path = route.path;
  const effectiveOrgId = ctx.overrideParams?.orgId ?? ctx.orgId;
  path = path.replace(":orgId", effectiveOrgId);

  if (path.includes(":eventId")) {
    const effectiveEventId = ctx.overrideParams?.eventId ?? ctx.eventId;
    if (!effectiveEventId) {
      throw new Error(`Missing eventId for route: ${routeKey}`);
    }
    path = path.replace(":eventId", effectiveEventId);
  }

  if (path.includes(":registrationId")) {
    const effectiveRegistrationId = ctx.overrideParams?.registrationId ?? ctx.registrationId;
    if (!effectiveRegistrationId) {
      throw new Error(`Missing registrationId for route: ${routeKey}`);
    }
    path = path.replace(":registrationId", effectiveRegistrationId);
  }

  return {
    method: route.method,
    path,
    headers,
    body,
  };
}
