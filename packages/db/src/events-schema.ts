import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema.ts";

export const events = pgTable(
  "events",
  {
    // 主键：uuid，默认由数据库 gen_random_uuid() 生成（PRD §5 锁定契约）
    id: uuid("id").primaryKey().defaultRandom(),

    // 所属组织：非空文本外键，指向 organization.id
    organizationId: text("organization_id").notNull(),

    // 活动标题与描述
    title: text("title").notNull(),
    description: text("description"),

    // 业务时间：timestamptz，采用 mode: "date" 映射为 JS Date 对象，保证时区语义完整
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(),
    registrationDeadline: timestamp("registration_deadline", {
      withTimezone: true,
      mode: "date",
    }).notNull(),

    // 容量：整数，必须满足 CHECK (capacity >= 1 AND capacity <= 1000)
    capacity: integer("capacity").notNull(),

    // 状态：默认 'open'，必须满足 CHECK (status IN ('open', 'cancelled'))
    status: text("status").default("open").notNull(),

    // 创建者：非空文本外键，指向 user.id
    createdBy: text("created_by").notNull(),

    // 审计时间戳
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    // Drizzle 的 .$onUpdate() 属于 ORM 层自动更新机制，仅对经由 Drizzle Query Builder 发起的
    // db.update() 生效；直接执行 raw SQL、pool.query() 或触发器写入时不自动触发（DEV-S2-04）。
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // 1. 复合唯一约束：供 S3 registrations 的复合外键引用，防止跨组织伪造 event_id
    unique("events_id_organization_id_unique").on(table.id, table.organizationId),

    // 2. 状态 CHECK 约束：仅允许 'open' 与 'cancelled'
    check("events_status_check", sql`status in ('open', 'cancelled')`),

    // 3. 容量 CHECK 约束：1 至 1000 人
    check("events_capacity_check", sql`capacity >= 1 and capacity <= 1000`),

    // 4. 业务截止时间 CHECK 约束：截止时间不得晚于开始时间
    check("events_deadline_check", sql`registration_deadline <= starts_at`),

    // 5. 组织外键：显式命名，ON DELETE RESTRICT，ON UPDATE NO ACTION（已定决策 DEV-S2-02）
    foreignKey({
      name: "events_organization_id_organization_id_fk",
      columns: [table.organizationId],
      foreignColumns: [organization.id],
    })
      .onDelete("restrict")
      .onUpdate("no action"),

    // 6. 创建者外键：显式命名，ON DELETE RESTRICT，ON UPDATE NO ACTION（已定决策 DEV-S2-03）
    foreignKey({
      name: "events_created_by_user_id_fk",
      columns: [table.createdBy],
      foreignColumns: [user.id],
    })
      .onDelete("restrict")
      .onUpdate("no action"),

    // 7. 业务检索索引：支持按组织与开始时间快速列出活动
    index("events_org_starts_idx").on(table.organizationId, table.startsAt),
  ],
);
