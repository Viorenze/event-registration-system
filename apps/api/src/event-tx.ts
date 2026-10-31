import { and, count, type Db, eq, events, registrations, sql } from "@event-system/db";
import { DomainError } from "./registrations.ts";

export type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function lockEventAndReadClock(tx: DbTransaction, orgId: string, eventId: string) {
  const [eventRow] = await tx
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizationId, orgId)))
    .for("update");

  if (!eventRow) {
    throw new DomainError("NOT_FOUND", "Event not found");
  }

  const clockRes = (await tx.execute(sql`SELECT clock_timestamp() AS current_time`)) as {
    rows: Array<{ current_time: string | Date }>;
  };
  const now = new Date(clockRes.rows[0].current_time);

  return { event: eventRow, now };
}

export function assertNotCancelled(event: { status: string }) {
  if (event.status === "cancelled") {
    throw new DomainError("EVENT_CANCELLED", "Event is cancelled");
  }
}

export function assertNotStarted(event: { startsAt: Date }, now: Date) {
  if (now.getTime() >= event.startsAt.getTime()) {
    throw new DomainError("EVENT_STARTED", "Event has already started");
  }
}

export async function promoteWaitlisted(
  tx: DbTransaction,
  params: { eventId: string; orgId: string; capacity: number },
  now: Date,
) {
  const [countRes] = await tx
    .select({ count: count() })
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, params.eventId),
        eq(registrations.organizationId, params.orgId),
        eq(registrations.status, "confirmed"),
      ),
    );

  const confirmedCount = Number(countRes?.count ?? 0);
  const free = params.capacity - confirmedCount;
  if (free <= 0) {
    return;
  }

  await tx.execute(sql`
    UPDATE registrations
    SET status = 'confirmed', promoted_at = ${now}
    WHERE id IN (
      SELECT id FROM registrations
      WHERE event_id = ${params.eventId}
        AND organization_id = ${params.orgId}
        AND status = 'waitlisted'
      ORDER BY seq ASC
      LIMIT ${free}
    )
  `);
}
