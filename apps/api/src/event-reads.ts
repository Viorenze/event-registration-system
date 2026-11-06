import { and, asc, eq, events, inArray, registrations, sql, user, type Db } from "@event-system/db";
import { DomainError } from "./domain-error.ts";

export interface EventDetailResult {
  id: string;
  organizationId: string;
  title: string;
  description: string | null;
  startsAt: string;
  registrationDeadline: string;
  capacity: number;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  confirmedCount: number;
  waitlistedCount: number;
  myRegistration: {
    id: string;
    status: "confirmed" | "waitlisted";
  } | null;
}

export interface EventRegistrationItem {
  id: string;
  userId: string;
  name: string;
  status: "confirmed" | "waitlisted";
  createdAt: string;
}

export async function getEventDetail(
  db: Db,
  orgId: string,
  eventId: string,
  userId: string,
): Promise<EventDetailResult> {
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

  const [eventRow] = await db
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
    .where(and(eq(events.id, eventId), eq(events.organizationId, orgId)));

  if (!eventRow) {
    throw new DomainError("NOT_FOUND", "Event not found");
  }

  const [myRegRow] = await db
    .select({
      id: registrations.id,
      status: registrations.status,
    })
    .from(registrations)
    .where(
      and(
        eq(registrations.organizationId, orgId),
        eq(registrations.eventId, eventId),
        eq(registrations.userId, userId),
        inArray(registrations.status, ["confirmed", "waitlisted"]),
      ),
    );

  const myRegistration = myRegRow
    ? {
        id: myRegRow.id,
        status: myRegRow.status as "confirmed" | "waitlisted",
      }
    : null;

  return {
    ...eventRow,
    description: eventRow.description ?? null,
    startsAt: eventRow.startsAt.toISOString(),
    registrationDeadline: eventRow.registrationDeadline.toISOString(),
    createdAt: eventRow.createdAt.toISOString(),
    updatedAt: eventRow.updatedAt.toISOString(),
    confirmedCount: Number(eventRow.confirmedCount ?? 0),
    waitlistedCount: Number(eventRow.waitlistedCount ?? 0),
    myRegistration,
  };
}

export async function getEventRegistrations(
  db: Db,
  orgId: string,
  eventId: string,
  _userId?: string,
): Promise<EventRegistrationItem[]> {
  const [eventRow] = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizationId, orgId)));

  if (!eventRow) {
    throw new DomainError("NOT_FOUND", "Event not found");
  }

  const rows = await db
    .select({
      id: registrations.id,
      userId: registrations.userId,
      name: user.name,
      status: registrations.status,
      createdAt: registrations.createdAt,
    })
    .from(registrations)
    .innerJoin(user, eq(registrations.userId, user.id))
    .where(
      and(
        eq(registrations.organizationId, orgId),
        eq(registrations.eventId, eventId),
        inArray(registrations.status, ["confirmed", "waitlisted"]),
      ),
    )
    .orderBy(asc(registrations.seq));

  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    name: r.name,
    status: r.status as "confirmed" | "waitlisted",
    createdAt: r.createdAt.toISOString(),
  }));
}
