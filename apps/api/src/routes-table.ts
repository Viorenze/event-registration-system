export interface RouteEntry {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  minRole: "member" | "admin" | "owner";
}

export const routesTable: RouteEntry[] = [
  {
    method: "GET",
    path: "/api/orgs/:orgId/members",
    minRole: "member",
  },
  {
    method: "POST",
    path: "/api/orgs/:orgId/events",
    minRole: "admin",
  },
  {
    method: "GET",
    path: "/api/orgs/:orgId/events",
    minRole: "member",
  },
  {
    method: "POST",
    path: "/api/orgs/:orgId/events/:eventId/registrations",
    minRole: "member",
  },
  {
    method: "DELETE",
    path: "/api/orgs/:orgId/events/:eventId/registrations/me",
    minRole: "member",
  },
  {
    method: "DELETE",
    path: "/api/orgs/:orgId/events/:eventId/registrations/:registrationId",
    minRole: "admin",
  },
  {
    method: "PATCH",
    path: "/api/orgs/:orgId/events/:eventId",
    minRole: "admin",
  },
  {
    method: "POST",
    path: "/api/orgs/:orgId/events/:eventId/cancel",
    minRole: "admin",
  },
];
