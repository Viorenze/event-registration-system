import { and, count, type Db, eq, events, inArray, registrations } from "@event-system/db";
import {
  assertNotCancelled,
  assertNotStarted,
  lockEventAndReadClock,
  promoteWaitlisted,
} from "./event-tx.ts";

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
    // 1. 事务内先锁活动行并读时钟
    const { event, now } = await lockEventAndReadClock(tx, orgId, eventId);

    // 2. 检查顺序：先判已取消，再判已开始
    assertNotCancelled(event);
    assertNotStarted(event, now);

    // 3. 查该用户在该活动的有效报名（confirmed 或 waitlisted），查询必须带 event_id、user_id、organization_id
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

    // 4. 已过报名截止（now >= registration_deadline）→ REGISTRATION_CLOSED
    if (now.getTime() >= event.registrationDeadline.getTime()) {
      throw new DomainError("REGISTRATION_CLOSED", "Registration is closed");
    }

    // 5. 数 confirmed 条数（带 event_id、organization_id），小于 capacity 则 confirmed 否则 waitlisted，插入
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
    const newStatus = confirmedCount < event.capacity ? "confirmed" : "waitlisted";

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

    // 6. 事务正常提交
    return {
      registration: inserted,
      isCreated: true,
    };
  });
}

export interface CancelResult {
  kind: "cancelled" | "noop";
}

export interface UpdateEventPatch {
  title?: string;
  description?: string | null;
  capacity?: number;
}

export async function cancel(
  db: Db,
  orgId: string,
  eventId: string,
  target: { me: true } | { registrationId: string },
  actor: { userId: string; role: string },
): Promise<CancelResult> {
  return await db.transaction(async (tx) => {
    // 流程：锁 → 读时钟 → EVENT_CANCELLED → EVENT_STARTED
    const { event, now } = await lockEventAndReadClock(tx, orgId, eventId);
    assertNotCancelled(event);
    assertNotStarted(event, now);

    let targetReg: { id: string; status: string } | undefined;

    if ("me" in target) {
      // me：只查调用者自己的有效报名，没有则 noop
      const [myReg] = await tx
        .select({
          id: registrations.id,
          status: registrations.status,
        })
        .from(registrations)
        .where(
          and(
            eq(registrations.eventId, eventId),
            eq(registrations.organizationId, orgId),
            eq(registrations.userId, actor.userId),
            inArray(registrations.status, ["confirmed", "waitlisted"]),
          ),
        );

      if (!myReg) {
        return { kind: "noop" };
      }
      targetReg = myReg;
    } else {
      // :registrationId：按 registrationId + eventId + organizationId 查，查不到 NOT_FOUND；已是 cancelled 则提前 noop
      const [existingReg] = await tx
        .select({
          id: registrations.id,
          status: registrations.status,
        })
        .from(registrations)
        .where(
          and(
            eq(registrations.id, target.registrationId),
            eq(registrations.eventId, eventId),
            eq(registrations.organizationId, orgId),
          ),
        );

      if (!existingReg) {
        throw new DomainError("NOT_FOUND", "Registration not found");
      }

      if (existingReg.status === "cancelled") {
        return { kind: "noop" };
      }
      targetReg = existingReg;
    }

    // 取消 confirmed 时写 cancelled_at = now，然后调 promoteWaitlisted；取消 waitlisted 不递补
    await tx
      .update(registrations)
      .set({
        status: "cancelled",
        cancelledAt: now,
      })
      .where(
        and(
          eq(registrations.id, targetReg.id),
          eq(registrations.eventId, eventId),
          eq(registrations.organizationId, orgId),
        ),
      );

    if (targetReg.status === "confirmed") {
      await promoteWaitlisted(tx, { eventId, orgId, capacity: event.capacity }, now);
    }

    return { kind: "cancelled" };
  });
}

export async function updateEvent(
  db: Db,
  orgId: string,
  eventId: string,
  patch: UpdateEventPatch,
): Promise<typeof events.$inferSelect> {
  return await db.transaction(async (tx) => {
    // 严格按 S6-a
    // 1. 锁活动行，查不到 → 404
    // 2. 读一次 clock_timestamp()（独立语句）
    const { event, now } = await lockEventAndReadClock(tx, orgId, eventId);

    // 3. 已取消 → 409 EVENT_CANCELLED
    assertNotCancelled(event);

    const hasCapacity = "capacity" in patch && patch.capacity !== undefined;

    // 4. 请求体含 capacity 且活动已开始 → 409 EVENT_STARTED
    if (hasCapacity) {
      assertNotStarted(event, now);
    }

    // 5. 含 capacity 时，先判断调小是否低于当前确认数（CAPACITY_BELOW_CONFIRMED）：在 UPDATE 之前，用锁后读到的确认数
    if (hasCapacity) {
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
      if (patch.capacity! < confirmedCount) {
        throw new DomainError(
          "CAPACITY_BELOW_CONFIRMED",
          "Capacity cannot be below confirmed count",
        );
      }
    }

    // 6. UPDATE 写入各字段
    const updateValues: Record<string, unknown> = {
      updatedAt: now,
    };
    if (patch.title !== undefined) {
      updateValues.title = patch.title;
    }
    if (patch.description !== undefined) {
      updateValues.description = patch.description;
    }
    if (hasCapacity) {
      updateValues.capacity = patch.capacity!;
    }

    const [updatedEvent] = await tx
      .update(events)
      .set(updateValues)
      .where(and(eq(events.id, eventId), eq(events.organizationId, orgId)))
      .returning();

    // 7. 含 capacity 时，用更新后的容量按 BR-7 递补
    if (hasCapacity) {
      await promoteWaitlisted(tx, { eventId, orgId, capacity: patch.capacity! }, now);
    }

    // 8. 提交
    return updatedEvent;
  });
}

export async function cancelEvent(
  db: Db,
  orgId: string,
  eventId: string,
): Promise<typeof events.$inferSelect> {
  return await db.transaction(async (tx) => {
    // 严格按 S6-b
    // 1. 锁活动行，查不到 → 404
    // 2. 读一次 clock_timestamp()（独立语句）
    const { event, now } = await lockEventAndReadClock(tx, orgId, eventId);

    // 3. 活动已取消 → 409 EVENT_CANCELLED
    assertNotCancelled(event);

    // 4. 活动已开始 → 409 EVENT_STARTED
    assertNotStarted(event, now);

    // 5. 置 cancelled，不触碰 registrations，不递补
    const [updatedEvent] = await tx
      .update(events)
      .set({
        status: "cancelled",
        updatedAt: now,
      })
      .where(and(eq(events.id, eventId), eq(events.organizationId, orgId)))
      .returning();

    // 6. 提交
    return updatedEvent;
  });
}
