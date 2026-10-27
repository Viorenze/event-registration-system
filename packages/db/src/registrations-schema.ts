import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema.ts";
import { events } from "./events-schema.ts";

export const registrations = pgTable(
  "registrations",
  {
    // 主键：uuid，默认由数据库 gen_random_uuid() 生成（PRD §5 锁定契约）
    id: uuid("id").primaryKey().defaultRandom(),

    // 关联活动：uuid，非空
    eventId: uuid("event_id").notNull(),

    // 所属组织：非空文本，与 eventId 共同构成复合外键
    organizationId: text("organization_id").notNull(),

    // 报名用户：非空文本，指向 user.id
    userId: text("user_id").notNull(),

    // 状态：非空，必须满足 CHECK (status in ('confirmed', 'waitlisted', 'cancelled'))
    status: text("status").notNull(),

    // 排队序号：bigint，GENERATED ALWAYS AS IDENTITY，映射为 JS number
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),

    // 审计与状态时间戳：timestamptz
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    promotedAt: timestamp("promoted_at", { withTimezone: true, mode: "date" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    // 1. 状态 CHECK 约束：显式命名 registrations_status_check
    check("registrations_status_check", sql`status in ('confirmed', 'waitlisted', 'cancelled')`),

    // 2. 复合外键：(event_id, organization_id) → events (id, organization_id)，ON DELETE RESTRICT, ON UPDATE NO ACTION
    foreignKey({
      name: "registrations_event_org_fk",
      columns: [table.eventId, table.organizationId],
      foreignColumns: [events.id, events.organizationId],
    })
      .onDelete("restrict")
      .onUpdate("no action"),

    // 3. 用户外键：user_id → user.id，ON DELETE RESTRICT, ON UPDATE NO ACTION
    foreignKey({
      name: "registrations_user_id_fk",
      columns: [table.userId],
      foreignColumns: [user.id],
    })
      .onDelete("restrict")
      .onUpdate("no action"),

    // 4. 部分唯一索引：(event_id, user_id) WHERE status in ('confirmed', 'waitlisted')
    uniqueIndex("registrations_event_user_active_uniq")
      .on(table.eventId, table.userId)
      .where(sql`status in ('confirmed', 'waitlisted')`),

    // 5. 业务检索与递补索引：(event_id, status, seq)
    index("registrations_event_status_seq_idx").on(table.eventId, table.status, table.seq),
  ],
);
