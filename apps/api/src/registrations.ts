import { and, count, type Db, eq, events, inArray, registrations, sql } from "@event-system/db";

export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export interface RegistrationDto {
  id: string;
  eventId: string;
  userId: string;
  status: string;
  createdAt: Date;
}

export interface RegisterResult {
  registration: RegistrationDto;
  isCreated: boolean;
}

export async function register(
  db: Db,
  orgId: string,
  eventId: string,
  userId: string,
): Promise<RegisterResult> {
  return await db.transaction(async (tx) => {
    // 1. 事务内 SELECT ... FROM events WHERE id=:eventId AND organization_id=:orgId FOR UPDATE；查不到抛 NOT_FOUND。
    const [eventRow] = await tx
      .select({
        id: events.id,
        organizationId: events.organizationId,
        startsAt: events.startsAt,
        registrationDeadline: events.registrationDeadline,
        capacity: events.capacity,
        status: events.status,
      })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.organizationId, orgId)))
      .for("update");

    if (!eventRow) {
      throw new DomainError("NOT_FOUND", "Event not found");
    }

    // 2. 取得锁之后，用一条独立语句 SELECT clock_timestamp() 读数据库时间，只读一次，不用 now()，不用应用时钟。
    const clockRes = await tx.execute<{ current_time: string | Date }>(
      sql`SELECT clock_timestamp() AS current_time`,
    );
    const dbNow = new Date(clockRes.rows[0].current_time);

    // 先判已取消 → EVENT_CANCELLED，再判已开始（now >= starts_at）→ EVENT_STARTED。
    if (eventRow.status === "cancelled") {
      throw new DomainError("EVENT_CANCELLED", "Event is cancelled");
    }
    if (dbNow.getTime() >= eventRow.startsAt.getTime()) {
      throw new DomainError("EVENT_STARTED", "Event has already started");
    }

    // 3. 查该用户在该活动的有效报名（confirmed 或 waitlisted），查询必须带 event_id、user_id、organization_id；有则返回它（isCreated=false），事务正常提交，不插入。
    const [existingActive] = await tx
      .select({
        id: registrations.id,
        eventId: registrations.eventId,
        userId: registrations.userId,
        status: registrations.status,
        createdAt: registrations.createdAt,
      })
      .from(registrations)
      .where(
        and(
          eq(registrations.eventId, eventId),
          eq(registrations.userId, userId),
          eq(registrations.organizationId, orgId),
          inArray(registrations.status, ["confirmed", "waitlisted"]),
        ),
      );

    if (existingActive) {
      return {
        registration: existingActive,
        isCreated: false,
      };
    }

    // 4. 已过报名截止（now >= registration_deadline）→ REGISTRATION_CLOSED。
    if (dbNow.getTime() >= eventRow.registrationDeadline.getTime()) {
      throw new DomainError("REGISTRATION_CLOSED", "Registration is closed");
    }

    // 5. 数 confirmed 条数（带 event_id、organization_id），小于 capacity 则 confirmed 否则 waitlisted，插入。
    // registrations.organization_id 取自函数参数 orgId，不取自活动行（复合外键路径）。
    const [countRes] = await tx
      .select({ count: count() })
      .from(registrations)
      .where(
        and(
          eq(registrations.eventId, eventId),
          eq(registrations.organizationId, orgId),
          eq(registrations.status, "confirmed"),
        ),
      );

    const confirmedCount = Number(countRes?.count ?? 0);
    const newStatus = confirmedCount < eventRow.capacity ? "confirmed" : "waitlisted";

    const [inserted] = await tx
      .insert(registrations)
      .values({
        eventId,
        organizationId: orgId,
        userId,
        status: newStatus,
      })
      .returning({
        id: registrations.id,
        eventId: registrations.eventId,
        userId: registrations.userId,
        status: registrations.status,
        createdAt: registrations.createdAt,
      });

    // 6. 事务正常提交。
    return {
      registration: inserted,
      isCreated: true,
    };
  });
}
