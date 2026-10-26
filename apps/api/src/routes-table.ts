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
];
