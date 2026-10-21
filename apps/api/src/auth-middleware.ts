import { and, eq, member } from "@event-system/db";
import { z } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { auth, db } from "./auth.ts";

export type MemberRole = "member" | "admin" | "owner";

export const ROLE_HIERARCHY: Record<string, number> = {
  member: 1,
  admin: 2,
  owner: 3,
};

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const orgAuthMiddleware: MiddlewareHandler = async (c, next) => {
  let session;
  try {
    session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });
  } catch {
    return c.json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, 500);
  }

  if (!session || !session.user) {
    return c.json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } }, 401);
  }

  const orgId = c.req.param("orgId");
  if (!orgId) {
    return c.json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } }, 401);
  }

  try {
    const [foundMember] = await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.userId, session.user.id), eq(member.organizationId, orgId)))
      .limit(1);

    if (!foundMember) {
      return c.json(
        { error: { code: "FORBIDDEN", message: "Not a member of this organization" } },
        403,
      );
    }

    c.set("user", session.user);
    c.set("session", session.session);
    c.set("orgId", orgId);
    c.set("memberRole", foundMember.role);

    await next();
  } catch {
    return c.json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, 500);
  }
};

export const requireRole = (minRole: MemberRole): MiddlewareHandler => {
  return async (c, next) => {
    const role = c.get("memberRole");
    const userLevel = ROLE_HIERARCHY[role];
    const minLevel = ROLE_HIERARCHY[minRole];

    if (userLevel === undefined || userLevel < minLevel) {
      return c.json({ error: { code: "FORBIDDEN", message: "Insufficient permissions" } }, 403);
    }

    await next();
  };
};
