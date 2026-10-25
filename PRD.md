# 活动报名系统 PRD

> 本文件是这个项目的唯一事实来源。AGENTS.md 指向它。
> 标「【锁定】」的内容，不经作者同意不得改动；其余部分可以在切片计划里细化，但不得与锁定内容冲突。
> 本文件只锁定与安全、正确性相关的契约（权限、数据库约束、事务规则、验收测试）。页面细节、样式、字段文案不在此规定。

## 1. 产品

团队管理员创建有名额限制的活动；成员报名，满员进候补；有人取消时，候补按先后顺序自动递补。每个团队的数据相互隔离。

核心流程：注册/登录 → 创建团队，或被邀请加入团队 → 管理员创建活动 → 成员报名 → 取消并递补。

### 不做【锁定】

支付、邮件通知、日历同步、图片上传、团队内部 Teams、AI 功能、候补超时确认、重复活动、导出、多语言。

## 2. 两个硬证据【锁定】

整个项目要证明的只有这两件事，其余功能都为它们服务。

1. **并发不超卖。** 50 个不同用户同时抢 10 个名额：数据库里 10 条确认、40 条候补、确认数超过名额为 0、同一用户重复有效报名为 0。以数据库最终状态为准，不以 HTTP 返回值为准。
2. **组织隔离。** A 组织的用户读取、修改、报名 B 组织的活动，全部被拒绝，数据库不变。

## 3. 业务规则

编号用于测试和提交信息里引用。

| 编号 | 规则 |
| --- | --- |
| BR-1 | 任何登录用户可创建团队，创建者是该团队的 owner。一个用户可属于多个团队。一个团队 = 一个 Better Auth Organization，不启用 Teams。角色只用默认的 owner / admin / member。 |
| BR-2 | 加入团队：owner/admin 按邮箱邀请，界面上复制邀请链接发给对方，不发邮件。受邀人用同一邮箱登录后接受。若 D2 超过 2 小时仍跑不通，退回：owner/admin 按邮箱直接添加已注册用户（服务端 addMember）。 |
| BR-3 | 活动字段：标题（1–120 字）、说明（可空）、开始时间、报名截止时间、名额（1–1000）。报名截止时间必须不晚于开始时间。创建时开始时间必须在未来（以数据库时间为准，见第 6 节）。 |
| BR-4 | 报名资格：用户是该活动所属团队的成员；活动状态为 open；数据库当前时间早于报名截止时间。业务时间判断以数据库的 `clock_timestamp()`（实际当前时间）为准，并且必须在取得活动行锁之后、用一条独立的 SQL 语句读取（见第 6 节）；不用应用服务器的时钟，也不用 `now()`：它是事务开始时间，事务在行锁上等待之后会早于实际时间。 |
| BR-5 | 报名结果：确认人数小于名额则为 `confirmed`，否则为 `waitlisted`。 |
| BR-6 | 报名截止后：拒绝新报名（会产生新记录的报名）；用户已有有效报名时，重复报名仍按 BR-9 返回已有报名，不新增；取消仍允许，取消后照常递补。活动开始后：报名（含重复报名）、取消、改名额一律拒绝。 |
| BR-7 | 递补：取消一条 `confirmed` 后，在同一个事务里，把 `waitlisted` 按 `seq` 从小到大改为 `confirmed`，直到名额满或没有候补。取消一条 `waitlisted` 不触发递补。不跳人。 |
| BR-8 | 改名额：调大，在同一个事务里按 BR-7 的顺序递补新空出的位置。调小，不得低于当前确认人数，否则拒绝（`CAPACITY_BELOW_CONFIRMED`）。 |
| BR-9 | 重复与重报：同一活动、同一用户，同一时间只能有一条有效（`confirmed` 或 `waitlisted`）报名。重复报名是幂等的：返回已有报名，不新增，不报错。活动已开始或已取消时，先按 BR-6、BR-10 拒绝；只有报名截止后仍返回已有有效报名（覆盖响应丢失后重试的场景）。取消后可以重新报名，排到队尾。 |
| BR-10 | 取消活动（优先级最低，时间紧就砍）：owner/admin 可把活动置为 `cancelled`。已取消的活动拒绝报名（含重复报名）、取消报名和一切变更，已有报名保留原样。 |

### 不变量【锁定】

任何时刻、对任何活动，下面三条都必须成立。测试直接查数据库，验证操作完成后的最终状态，证明范围见第 8 节。

- **INV-1** `confirmed` 条数 ≤ 活动名额。
- **INV-2** 若存在 `waitlisted`，则 `confirmed` 条数 = 活动名额。
- **INV-3** 同一用户在同一活动里，有效报名最多一条。

## 4. 权限矩阵【锁定】

| 操作 | 未登录 | 非该团队成员 | member | admin | owner |
| --- | --- | --- | --- | --- | --- |
| 注册、登录、退出 | 可 | 可 | 可 | 可 | 可 |
| 创建团队 | 否 | 可（任何登录用户） | 可 | 可 | 可 |
| 邀请或添加成员 | 否 | 否 | 否 | 可 | 可 |
| 查看活动列表、详情 | 否 | 否 | 可 | 可 | 可 |
| 创建、修改、取消活动 | 否 | 否 | 否 | 可 | 可 |
| 报名、取消自己的报名 | 否 | 否 | 可 | 可 | 可 |
| 取消他人的报名 | 否 | 否 | 否 | 可 | 可 |
| 查看全部报名名单 | 否 | 否 | 否 | 可 | 可 |

规则：

- 未登录返回 401。已登录但不是 URL 里 `:orgId` 团队的成员，返回 403。角色不够返回 403。
- 活动 id 不属于 `:orgId` 团队，返回 404，不泄露它是否存在。
- 权限检查由我们自己的中间件做：查 `member` 表里 (用户, `:orgId`) 这一行及其角色。不依赖会话里的 `activeOrganizationId`，也不假设 Better Auth 的角色会自动保护自定义接口。
- 每个自建业务接口先过中间件，再进业务代码（Better Auth 的 `/api/auth/*` 是例外，见下一条）。每条数据库查询都带 `organization_id` 条件。
- Better Auth 自带的团队管理接口（`/api/auth/organization/*`）：产品只用到创建团队、邀请成员、接受邀请。删除团队接口禁用（配置 `disableOrganizationDeletion: true`，选项名以所装版本为准）。更新团队信息、移除成员、修改成员角色、退出团队、取消邀请不做界面；这些接口不经我们的中间件，权限保持 Better Auth 默认（owner 可做全部；admin 不能删除团队、不能更改 owner；member 只读）。创建团队、删除团队、移除成员、修改成员角色由 I7 验证：默认权限确实生效、不跨团队。更新团队信息、退出团队、取消邀请不单独测，列入 README 已知限制。

## 5. 数据模型

### 认证表

`user`、`session`、`account`、`verification`、`organization`、`member`、`invitation`：由 Better Auth CLI 生成，并入 Drizzle schema，只用 Drizzle Kit 迁移。不手写、不改它们的列。不要对数据库运行 Better Auth 自带的迁移。

### 业务表【锁定约束】

**events**

| 列 | 类型与约束 |
| --- | --- |
| id | uuid，主键 |
| organization_id | text，非空，外键 → organization.id |
| title | text，非空 |
| description | text，可空 |
| starts_at | timestamptz，非空 |
| registration_deadline | timestamptz，非空，CHECK ≤ starts_at |
| capacity | integer，非空，CHECK 1–1000 |
| status | text，非空，默认 `open`，CHECK 取值只能是 `open`、`cancelled` |
| created_by | text，非空，外键 → user.id |
| created_at、updated_at | timestamptz，非空 |

约束：`UNIQUE (id, organization_id)`（供 registrations 的复合外键使用）；索引 `(organization_id, starts_at)`。

**registrations**

| 列 | 类型与约束 |
| --- | --- |
| id | uuid，主键 |
| event_id | uuid，非空 |
| organization_id | text，非空 |
| user_id | text，非空，外键 → user.id |
| status | text，非空，CHECK 取值只能是 `confirmed`、`waitlisted`、`cancelled` |
| seq | bigint，`GENERATED ALWAYS AS IDENTITY`，排队顺序 |
| created_at | timestamptz，非空 |
| promoted_at、cancelled_at | timestamptz，可空 |

约束：

- 复合外键 `(event_id, organization_id)` → `events (id, organization_id)`，保证报名和活动属于同一团队。若 Drizzle 对复合外键的支持有问题，退回单列外键，并在写入时从活动行取 `organization_id`，记入 DECISIONS.md。
- 部分唯一索引：`UNIQUE (event_id, user_id) WHERE status IN ('confirmed','waitlisted')`。这是 INV-3 的最后一道防线，不是主要手段。
- 索引 `(event_id, status, seq)`。

`seq` 在事务持有活动行锁时才会被分配，所以同一活动里 `seq` 的顺序就是排队顺序。

## 6. 事务契约【锁定】

全部使用默认的 READ COMMITTED 隔离级别 + 活动行锁，不使用 SERIALIZABLE。锁的顺序固定：**先活动行，后报名行**，避免死锁。

**时间判断**：业务时间窗口（报名截止、活动开始）以数据库的 `clock_timestamp()` 为准。取得活动行锁之后，用一条独立于加锁语句的 SQL 读取它，再据此判断：不早于 `starts_at` 为已开始，不早于 `registration_deadline` 为已截止。不得把读取时间的表达式放进加锁那条语句，不用 `now()`，不用应用服务器的时钟。原因：`now()` 返回事务开始时间，事务在行锁上等待期间截止时间可能已过，用它判断会放过超时报名（PostgreSQL 官方文档：`now()` 等价于 `transaction_timestamp()`，`clock_timestamp()` 返回实际当前时间）。一次操作里只读一次，该操作内所有时间判断共用这个值。

**活动状态检查的固定顺序**：先判断已取消（409 `EVENT_CANCELLED`），再判断已开始（409 `EVENT_STARTED`）。

**事务写法**：下面各步里的「返回」，指从事务回调里返回结果，由事务包装器正常提交；拒绝（404、409 等）通过抛出带 `code` 的领域错误使事务回滚。不得在持有活动行锁时绕开事务包装器去结束流程。业务层只表达领域结果和领域错误，HTTP 状态码由路由层按第 7 节映射，映射由 A1 验证。各步里写的 404、409、204，是路由层映射出的 HTTP 状态码；业务层返回的是对应的领域错误（`NOT_FOUND`、`EVENT_STARTED` 等）或「无操作」结果。

**创建活动** `createEvent`：此时没有活动行可锁。在事务中用一条独立的 SQL 读取数据库的 `clock_timestamp()`，校验 `starts_at` 晚于它（BR-3），不用应用服务器的时钟；不满足 → 400 `VALIDATION`。这是「先锁活动行、再读时间」规则唯一的例外：已有活动的报名、取消、改名额、递补仍严格先锁后读。

**报名** `register(orgId, eventId, userId)`

1. 开事务。`SELECT … FROM events WHERE id = :eventId AND organization_id = :orgId FOR UPDATE`。查不到 → 404。
2. 读取数据库当前时间。活动已取消或已开始 → 409（BR-6、BR-10）。
3. 查是否已有该用户的有效报名；有 → 把它作为事务的结果返回（BR-9）：事务正常提交，不插入任何行。
4. 已过报名截止时间（BR-4）→ 409 `REGISTRATION_CLOSED`。
5. 数出 `confirmed` 条数，按 BR-5 决定状态，插入。
6. 提交。

第 3 步在第 4 步之前：用户第一次报名已成功、响应丢失，截止后重试，应拿回已有报名，而不是 `REGISTRATION_CLOSED`。已开始或已取消的活动不适用这个例外。

**取消** `cancel(orgId, eventId, target, actor)`，`target` 是 `me`（当前用户自己的有效报名）或 `registrationId`

1. 权限由中间件先检查（`me`：member+，只作用于调用者自己；`:registrationId`：admin+），再进业务代码。
2. 开事务。锁活动行（同上），查不到 → 404。
3. 读取数据库当前时间。活动已取消或已开始 → 409。报名截止后允许取消（BR-6）。
4. 定位报名：
   - `me`：该用户在这个活动里的有效报名。没有 → 提交事务，返回 204，不改库（幂等 no-op）。
   - `:registrationId`：按 `registrationId + eventId + organizationId` 共同查找，查不到 → 404，不得只按报名 id 查找。已是 `cancelled` → 幂等返回 204，不再递补。
5. 置为 `cancelled`，写 `cancelled_at`。若原状态是 `confirmed`，按 BR-7 递补。
6. 提交。

**改名额** `updateEvent`：锁活动行，查不到 → 404；读取数据库当前时间；活动已取消 → 409；改名额时活动已开始 → 409（BR-6）；调小按 BR-8 校验；调大按 BR-7 递补；提交。

任何时候不得在没有活动行锁的情况下读取确认人数并据此写入。

## 7. 接口

所有业务接口挂在 Hono 的 `/api` 下，路径里带 `:orgId`。认证由 Better Auth 挂在 `/api/auth/*`，不在这里重复列出。浏览器通过 Next.js 的同源代理访问（见第 9 节的验证项 4）。

| 方法 | 路径 | 角色 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/orgs/:orgId/members` | member+ | 成员列表（响应数组每项包含 `userId`、`name`、`role`，不含 `email`） |
| POST | `/api/orgs/:orgId/members` | admin+ | 按邮箱直接添加已注册用户（BR-2 的退路；邀请走 Better Auth） |
| GET | `/api/orgs/:orgId/events` | member+ | 活动列表，含确认数和候补数（确认数、候补数自 S3 起返回）；`limit` 默认 20 |
| POST | `/api/orgs/:orgId/events` | admin+ | 创建活动 |
| GET | `/api/orgs/:orgId/events/:eventId` | member+ | 详情，含我的报名状态 |
| PATCH | `/api/orgs/:orgId/events/:eventId` | admin+ | 修改活动（含名额） |
| POST | `/api/orgs/:orgId/events/:eventId/cancel` | admin+ | 取消活动（BR-10，可砍） |
| POST | `/api/orgs/:orgId/events/:eventId/registrations` | member+ | 报名当前用户；首次创建报名返回 201，重复报名（返回已有报名，BR-9）返回 200；响应体都带报名 id 和状态（其余字段在 D3 契约定稿时写入本表） |
| DELETE | `/api/orgs/:orgId/events/:eventId/registrations/me` | member+ | 取消自己的报名；成功取消返回 204；没有有效报名时也返回 204 且不改库（幂等），但活动已取消或已开始时先返回 409（见第 6 节） |
| DELETE | `/api/orgs/:orgId/events/:eventId/registrations/:registrationId` | admin+ | 取消他人的报名；按 `registrationId + eventId + organizationId` 查找，查不到 404；成功取消或已取消均返回 204 |
| GET | `/api/orgs/:orgId/events/:eventId/registrations` | admin+ | 报名名单 |

错误格式统一为 `{ "error": { "code": "…", "message": "…" } }`。

| 状态码 | code | 场景 |
| --- | --- | --- |
| 400 | `VALIDATION` | 请求体不合法 |
| 401 | `UNAUTHENTICATED` | 未登录 |
| 403 | `FORBIDDEN` | 不是该团队成员，或角色不够 |
| 404 | `NOT_FOUND` | 活动或报名不存在，或不属于该团队；BR-2 回退时目标邮箱未注册 |
| 409 | `REGISTRATION_CLOSED` | 报名截止后报名 |
| 409 | `EVENT_STARTED` | 活动开始后的变更 |
| 409 | `EVENT_CANCELLED` | 已取消的活动 |
| 409 | `CAPACITY_BELOW_CONFIRMED` | 名额调到低于确认人数 |
| 500 | `INTERNAL_ERROR` | 内部服务器错误（外壳 `{ "error": { "code", "message" } }`，message 不泄露 SQL、连接串或内部细节） |

**条件功能与裁剪**：

- `POST …/members` 只在 BR-2 退回时实现。邀请走通就不实现，也不进路由表（I5 要求路由表与实际路由一致）。退回时：路由表加这一行，I6 作废，I7 保留，该接口由 I1–I4 覆盖。
- BR-10 默认保留。砍掉时，在同一次提交里同步删除：`POST …/cancel` 路由行、`EVENT_CANCELLED` 错误码行、BR-10 条文，以及 BR-6、BR-9、第 6 节里关于「已取消」的判断，A1、C6、C8 里「BR-10 保留时」的断言。`events.status` 列和它的 CHECK 保留不动（表已建好，不为此改迁移）。
- 是否砍 BR-10 由作者决定，最晚在 D4 的 Sonnet review 之前；review 之后不再改契约。

契约先行：路由用 Zod 定义请求和响应，由 Hono RPC 给前端类型，OpenAPI 只输出 `/doc` 文档。新增或改动接口，先改这里的表。

## 8. 验收测试【锁定】

全部连真实 PostgreSQL，不用 Mock。并发请求用同一个起跑信号同时发出。所有断言都查数据库最终状态。

### 调用路径与连接预算

- **调用路径**：并发与事务测试（C1–C8）直接调用业务层函数（`register`、`cancel`、`updateEvent`），不经 HTTP。HTTP 层（认证、中间件、校验、状态码映射）由 A1、I1–I7 和 E1–E3 覆盖；数据库约束（K1、K2）直接对数据库执行 SQL，同样不经业务层。README 如实写明这些边界。业务层以带 `code` 的领域错误表示拒绝，`code` 与第 7 节错误表一致；C 系列断言领域错误的 `code` 和数据库状态，不断言 HTTP 状态码。业务层函数接收数据库句柄；并发测试里每个 worker 用自己独占的一条连接。
- **证明是独立连接**：C1 起跑前，每个 worker 先用自己的连接查一次 `pg_backend_pid()`，断言 50 个 pid 互不相同，然后同时开始。避免连接池排队把并发串行化。
- **连接预算**：PostgreSQL 的 `max_connections` 默认通常是 100，`superuser_reserved_connections` 默认 3，`reserved_connections` 默认 0（官方文档）；普通用户实际可用数 = `max_connections` − `superuser_reserved_connections` − `reserved_connections`，默认约 97。并发测试池上限 60（50 个 worker + 控制事务 + 余量）；观察连接 1 条（查 `pg_stat_activity`，独立于测试池）；同时运行的应用（如果有）的连接池上限 ≤ 10；迁移等临时连接 ≤ 5。合计不超过 76。默认值以所用 PostgreSQL 版本和镜像配置为准，D1 用 `SHOW max_connections`、`SHOW superuser_reserved_connections`、`SHOW reserved_connections`（所用版本有这个参数时）实测并记入 `docs/DECISIONS.md`；Compose 或 CI 若改了该值，同样记录。**D1 通过条件**：实测可用数 ≥ 76。小于 76 不能只记录后继续：先在预算内下调（应用池、临时连接、测试池的余量；C1 要的 50 个独立连接和 1 条观察连接不能再减）；仍不够就停下来报告，由作者批准后在 Compose 与 CI 里显式设置 `max_connections`，记入 DECISIONS.md，再重新核对。CI 的 Postgres 在并发 job 首次运行时同样核对。
- **串行运行**：并发测试文件不与其他连库的测试文件同时运行（各文件的连接池会叠加）；CI 里它本来就是单独的 job。
- 以后若增加经 HTTP 的并发测试：应用池上限提到 ≥ 50，总数仍要留在 `max_connections` 减去保留连接之内，并先改本节。

### 数据库约束（D3）

第 5 节锁定的约束要在数据库层真的存在：绕过业务层、直接对数据库执行 SQL 写入违规数据，必须被数据库拒绝。

| 编号 | 场景 | 断言 |
| --- | --- | --- |
| K1 | `events` 的约束：直接写入违规数据 | 下列每一条都被数据库拒绝（约束错误），表不变：`status` 为 NULL，或不在 `open`、`cancelled` 内；`capacity` 为 0 或 1001；`registration_deadline` 晚于 `starts_at`；`organization_id` 指向不存在的团队 |
| K2 | `registrations` 的约束：直接写入违规数据 | 下列每一条都被数据库拒绝（约束错误），表不变：`status` 为 NULL，或不在 `confirmed`、`waitlisted`、`cancelled` 内；`(event_id, organization_id)` 与活动所属团队不一致；同一 `(event_id, user_id)` 再写入第二条 `confirmed` 或 `waitlisted` 报名（部分唯一索引）。对照：同一用户的那条报名先置为 `cancelled`，再写入新的有效报名，成功（证明唯一索引只约束有效报名） |

### 并发（D3–D4）

| 编号 | 场景 | 断言 |
| --- | --- | --- |
| C1 | 空活动，名额 10；50 个不同用户同时抢 | 恰好 10 条 `confirmed`、恰好 40 条 `waitlisted`；10 条 `confirmed` 的 `seq` 全部小于 40 条 `waitlisted` 的 `seq`；50 个 `seq` 互不相同；INV-1、2、3 成立；没有用户有重复的有效报名；起跑前 50 个连接的后端 pid 互不相同 |
| C2 | 同一用户并发报名 10 次 | 只有 1 条有效报名；10 个响应指向同一个报名 id |
| C3 | 满员且有 5 个候补，取消 1 个确认 | 确认数仍是名额；`seq` 最小的候补变为确认 |
| C4 | 并发：取消 3 个确认的同时，新用户继续报名 | 全部操作完成后，最终数据库状态满足 INV-1、2、3（只验证最终状态，范围见下） |
| C5 | 名额 10 → 15，有 5 个候补 | 5 个候补按 `seq` 顺序全部递补；调到低于确认数返回 `CAPACITY_BELOW_CONFIRMED` 错误；调到等于确认数成功 |
| C6 | 截止后、开始后、已取消后的各种操作；等锁期间截止时间已过（确定性交错，见下） | 截止后：新用户报名返回 `REGISTRATION_CLOSED` 错误；已有有效报名的用户重复报名返回原报名（同一 id）；取消仍成功并递补。开始后：报名（含重复报名）、取消、改名额全部返回 `EVENT_STARTED` 错误。已取消的活动（BR-10 保留时）：报名（含重复报名）、取消返回 `EVENT_CANCELLED` 错误。等锁交错：B 返回 `REGISTRATION_CLOSED` 错误，没有新记录。所有拒绝都不改数据库 |
| C7 | 确定性交错：事务 A 用 `SELECT … FOR NO KEY UPDATE` 持有活动行锁（不用 `FOR UPDATE`，原因见本表后的说明）时，事务 B 报名 | 轮询 `pg_stat_activity`（带超时，不用固定 `sleep`），直到 B 的后端 `wait_event_type = 'Lock'`；A 持锁期间 B 尚未完成，数据库里没有 B 的报名行；A 提交后 B 完成，B 的报名行出现。B 的会话设一个较长的 `lock_timeout`（如 10 秒），只用来防止测试无限挂起；触发它就说明测试失败，它不是「B 在等待」的证据 |
| C8 | 取消的幂等与定位 | 当前用户没有有效报名时，取消返回「无有效报名」的无操作结果，数据库不变；重复取消同一条报名，第二次是无操作，不触发第二次递补（确认数、`seq` 顺序都不变）；用同组织另一个活动的 id 去取消本活动的报名，返回 `NOT_FOUND` 错误，数据库不变；活动已取消（BR-10 保留时）或已开始时，没有有效报名的取消返回 `EVENT_CANCELLED` 或 `EVENT_STARTED` 错误，不是无操作结果。这些结果对应的 HTTP 状态码（204、404、409）由 A1 验证 |

**C1 为什么不断言候补的具体顺序**：并发请求的发起顺序不等于数据库取得行锁的顺序，测试没有办法观测「请求被处理的顺序」。`seq` 在持有活动行锁时分配，所以「先插入的 `seq` 更小」成立，C1 断言的正是这个结构：确认的 `seq` 全部小于候补的。队列顺序的语义由 C3 直接验证。

**C7 里 A 为什么用 `FOR NO KEY UPDATE`**：C7 要证明业务代码里的 `FOR UPDATE` 真的在起作用，所以删掉它之后 C7 必须变红。PostgreSQL 官方文档的行级锁冲突表：`FOR UPDATE` 与 `FOR KEY SHARE` 冲突，`FOR NO KEY UPDATE` 与 `FOR KEY SHARE` 不冲突；外键检查对被引用行加的是 `FOR KEY SHARE`（这一点来自第三方资料，没有对照官方文档，D3 用诊断步骤实测）。如果 A 用 `FOR UPDATE` 持锁，即使业务代码删掉了 `FOR UPDATE`，B 插入报名时的外键检查也会被 A 挡住，`wait_event_type = 'Lock'` 照样出现，C7 仍然绿，什么也证明不了。A 用 `FOR NO KEY UPDATE`：它与业务代码的 `FOR UPDATE` 冲突，B 会等；业务代码一旦删掉 `FOR UPDATE`，B 的外键检查不会被它挡住，B 不再等待，C7 变红。

**这组测试证明的范围**：C 系列断言的是所有操作完成后的最终数据库状态，不是每一次提交之后的中间状态。「任何时刻都成立」是对设计的要求，这些测试单独证明不了它：它依靠每个修改事务先锁活动行（同一活动的修改被串行化）和事务原子提交，再由诊断步骤间接验证（去掉 `FOR UPDATE` 后 C7 必须变红；C1、C4 作补充压力诊断，见下）。README、演示和面试里只说「最终状态验证 + 锁串行化的设计」，不说「每次提交都被验证过」。

**C6 等锁交错用例**（用来区分 `clock_timestamp()` 和 `now()`）：

1. 事务 A 锁住活动行并保持；此时活动尚未截止。
2. 事务 B（另一个用户）开始报名，卡在活动行锁上。
3. 轮询 `pg_stat_activity`（带超时），直到 B 的后端 `wait_event_type = 'Lock'`，证明 B 确实在等锁，不用固定 `sleep`。
4. A 执行 `UPDATE events SET registration_deadline = clock_timestamp() WHERE …`，然后提交。必须用 `clock_timestamp()`，不能用 `now()`：A 的事务开始得比 B 早，A 的 `now()` 会把截止时间设在 B 开始之前，B 即使错用 `now()` 也会判为已截止，测试就测不出差别。用 `clock_timestamp()`，截止时间落在 B 的事务开始之后，B 若错用 `now()` 就会放行。
5. B 获得锁后必须返回 409 `REGISTRATION_CLOSED`，数据库里没有 B 的报名记录。

诊断步骤：(1) 临时删掉 `FOR UPDATE`，重新跑 C1、C4、C7。C7 必须变红：A 持锁期间观察不到 B 在等锁，或 B 在 A 提交之前就完成了（C7 是确定性的交错测试，A 的持锁模式见上文 C7 的说明）。C1、C4 是并发压力场景，结果受调度影响，只作补充诊断，不要求每次都单独变红。(2) 临时把业务时间判断从 `clock_timestamp()` 换成 `now()`，重新跑 C6 的等锁交错用例，它应当变红。C7 或 C6 的等锁用例没变红，先查测试有没有真的观察到 B 在等锁、A 的持锁模式对不对、截止时间是不是用 `clock_timestamp()` 设的；C1、C4 多次都没暴露异常，再查竞态窗口太小、请求不是同时发出。不要默认测试有效，也不要默认代码有错。验证后把代码改回去。并发测试在 CI 里作为单独的 job 重复运行（建议 5 次），D4 验收时本地连续跑 20 次。

### API 契约（D3–D4）

C 系列直调业务层，不能证明路由层返回了正确的 HTTP 状态码，所以单独测一层映射。不起服务，进程内调用 Hono 应用（`app.request`），连真实 PostgreSQL，登录用户用测试里注册出来的会话。与 I1–I7 放在同一个 job。

| 编号 | 场景 | 断言 |
| --- | --- | --- |
| A1 | 关键的状态码与错误码映射 | 截止后新用户报名 409 `REGISTRATION_CLOSED`；新用户首次报名 201；截止后已有报名的用户重复报名 200，并返回同一个报名 id；开始后报名、取消、改名额 409 `EVENT_STARTED`；`DELETE …/registrations/me`：成功取消 204，没有有效报名 204，活动已开始 409；`DELETE …/registrations/:registrationId`（admin 调用）：首次成功取消他人的有效报名 204（场景：被取消的是 `confirmed` 且有候补，取消后数据库里 `seq` 最小的候补变为 `confirmed`）；对同一条报名重复取消 204，数据库不变，不再触发递补（确认数和各条报名的状态与第一次取消后完全相同，对应 C8）；用错误的活动 id 与报名 id 组合 404 `NOT_FOUND`；改名额低于确认数 409 `CAPACITY_BELOW_CONFIRMED`；创建活动时 `starts_at` 已过 400 `VALIDATION`；请求体不合法 400 `VALIDATION`；错误响应体符合 `{ "error": { "code", "message" } }`；BR-10 保留时：已取消的活动 409 `EVENT_CANCELLED` |

### 隔离（D2 起，D6 补全）

| 编号 | 场景 | 断言 |
| --- | --- | --- |
| I1 | 路由表里的每个受保护接口，未登录调用 | 401 |
| I2 | A 组织用户（member、admin、owner 各一）调用 `/orgs/<B>/…` | 403，数据库不变 |
| I3 | A 组织 admin 在 `/orgs/<A>/…` 里使用 B 组织的活动 id（读、改、报名、取消） | 404，数据库不变 |
| I4 | member 调用 admin+ 接口 | 403 |
| I5 | 路由表完整性：取 Hono 实际注册的处理器路由，减去显式豁免清单，剩下的（方法, 路径）集合必须与路由表的集合完全相等 | 多一条（新增的、未分类的路由）或少一条（路由表里有、实际不存在）都失败，这样新增路由必须同时加测试行 |
| I6 | Better Auth 的邀请接口（在 `/api/auth/*` 下，被 I5 豁免，所以单独测）：A 组织的 member、B 组织的 owner（不是 A 组织成员）分别为 A 组织创建邀请；对照组：A 组织的 admin、owner 创建邀请；接受流程：用 admin 创建的同一条邀请，先由邮箱不匹配的登录用户接受，再由邮箱匹配的登录用户接受 | 创建：member 和非成员被拒绝（状态码 D2 实测后写入本表），`invitation` 表没有新增记录；admin 和 owner 成功，`invitation` 表各新增 1 条（对照组，证明被拒绝是因为权限，而不是接口本身配置错了）。接受：邮箱不匹配的用户被拒绝，`member` 表没有新增行；随后邮箱匹配的用户成功，`member` 表新增 1 行，角色与邀请一致（必须先测被拒绝的，因为接受成功后邀请状态会变） |
| I7 | Better Auth 的团队管理接口（在 `/api/auth/*` 下，被 I5 豁免，所以单独测）：(a) 未登录创建团队；已登录用户创建团队。(b) A 组织的 owner 调用删除团队。(c) 移除成员、修改成员角色各用一名独立的 A 组织 member 作目标，互不影响对方的前置条件：A 组织的 member、B 组织的 owner（不是 A 组织成员）分别对各自的目标调用（改角色时改成 admin），先测被拒绝；对照组：A 组织的 owner 在这些被拒绝的用例之后，对各自的目标成功修改角色、成功移除成员。(d) A 组织的 admin 对 A 组织的 owner 调用修改角色（改成 member）、移除成员 | (a) 未登录被拒绝，`organization` 表没有新增；已登录用户成功，`member` 表里该用户在新团队的角色是 `owner`（BR-1）。(b) 被拒绝（删除已禁用），`organization`、`member`、`events` 的行数不变。(c) member 和非成员：被拒绝，`member` 表不变（行数和角色都不变）；对照组：owner 修改角色成功，该行角色变为 admin；owner 移除成员成功，该目标的 `member` 行被删除（证明被拒绝是因为权限，而不是接口本身配置错了，也不是目标已不存在）。(d) 被拒绝，`member` 表不变。被拒绝时的状态码 D2 实测后写入本表 |

路由表是一个数据文件，每行包含方法、路径、最低角色。I1–I4 对它做参数化测试。

豁免清单是另一个数据文件，按（方法, 路径）匹配，只列实际存在、不属于组织权限矩阵的路由。初始内容：`/api/auth/*`（Better Auth，通配；其中的邀请、团队管理接口由 I6、I7 单独测）、`/doc`（OpenAPI 文档）；若实现了健康检查路由，也写进去。新增任何豁免都必须经作者明确批准，不得自行扩大。从 Hono 取路由时要滤掉中间件项，具体写法 D2 实测。

I6 只在走 Better Auth 邀请时需要；若按 BR-2 退回直接添加，I6 作废，该行为由路由表里的 `POST /api/orgs/:orgId/members` 经 I2、I4 覆盖；报告里把 I6 标为不适用，不得声称 I6 通过。I7 与是否走邀请无关，始终保留。

I6 的接受流程保持 Better Auth 默认的邀请 id 生成方式：官方文档说，改用可预测的 id（如 `serial`）会要求邮箱已验证，而本项目不发邮件。

I7 对应 BR-1 和第 4 节末尾的说明。第一版至少含 (a)(b)；(c)(d) 在 D4 的 Sonnet review 之前补齐，让 review 能看到它们。删除团队的配置项名称，官方页的代码示例写作 `disableOrganizationDeletion`，正文却写作 `organizationDeletion`，前后不一致，D2 以所装版本的类型定义为准，记入 DECISIONS.md。官方文档只说 admin「不能更改 owner」，没有明说 admin 能否移除 owner：(c)(d) 若实测与文档说的默认权限不符，停下来报告，由作者决定是否加限制，不自行加钩子。

### 浏览器（D2 登录，D6 主流程）

- 认证：浏览器里注册、登录、读取会话、退出（D2）。
- E1：注册 → 创建团队 → 创建活动 → 报名成功（显示已确认）。
- E2：名额满后第二个用户报名显示候补；第一个用户取消后，第二个用户变为已确认。
- E3：B 组织的用户看不到、也打不开 A 组织的活动。

## 9. 技术验证（D1）

上午（项 1–3）总预算 4 小时，下午（项 4–6）总预算 4 小时，每一项最多 2 小时。有备选的项（1、4、6）超时就用备选，把结论写进 `docs/DECISIONS.md`，不要为了保住主方案拖延。没有备选的项（2、3、5：基础 CI、Postgres 与 Drizzle Kit 连库、认证表进 Drizzle 迁移与空库迁移）不能因为超时就记为通过：没通过就如实报告阻塞，停下来等作者，不要伪造结论。备选方案若要新增依赖（例如项 1 的独立 Vitest、Oxlint，项 6 的 `openapi-typescript`），在计划里提前列出理由，随计划一起审批；超时切换备选时只能用已批准的依赖，不得自行新增。

| 编号 | 时段 | 验证内容 | 备选 |
| --- | --- | --- | --- |
| 1 | 上午 | `vp check`、`vp test` 在含 Next.js 的工程里能跑通 | 独立 Vitest + Oxlint + `tsc --noEmit` |
| 2 | 上午 | PR 上基础 CI 全绿 | — |
| 3 | 上午 | `docker compose up` 起 Postgres，健康检查通过；Drizzle Kit 的配置被正确读取，并能连上这个库（用哪条命令验证，在计划里提出；不得靠新建表或手写迁移来验证）；连接预算核对通过（第 8 节：可用数 ≥ 76） | — |
| 4 | 下午 | API 级登录链路：经 Next.js 同源代理 `/api/*` 到 Hono，用 curl 带 cookie 文件：注册 → 读取会话 → 退出 → 会话为空 | 浏览器直接跨域请求，配 CORS、credentials、`trustedOrigins` |
| 5 | 下午 | 认证表进 Drizzle 迁移：Better Auth CLI 生成 → 并入 Drizzle schema → Drizzle Kit 迁移 → 空库迁移成功（真正的空库迁移验收在这一项） | — |
| 6 | 下午 | 一条示例路由：`@hono/zod-openapi` 定义，Next 端 `hc<AppType>` 调用类型正确，`/doc` 输出 OpenAPI | 用 `openapi-typescript` 生成类型 |

Hono RPC 的已知前提：服务端和客户端的 tsconfig 都开 `strict`；两端 Hono 版本一致；路由用链式写法；路由很多时 IDE 会变慢。

## 10. 切片

一个切片一个分支、一次提交。每个切片先写失败的测试，再实现，门禁全绿并且作者看过 diff 才合并。

| 切片 | 天 | 内容 | 验收 |
| --- | --- | --- | --- |
| S0 | D1 | 骨架、基础 CI、技术验证（第 9 节） | 六项各有结论，写入 DECISIONS.md |
| S1 | D2 | Better Auth + Organization + 权限中间件；邀请或添加成员；浏览器登录；隔离测试第一版 | 在 Docker Compose 起的本地环境里，浏览器能注册、登录、退出；A 组织读不到 B 组织；I1–I7 的第一版（I6 仅在走邀请时适用，回退时标为不适用，不得声称通过） |
| S2 | D3 | 契约定稿；创建与列出活动 | 路由表与第 7 节一致；K1 |
| S3 | D3 | 报名（事务 + 行锁） | C1、C2；A1 中报名相关的行；K2 |
| S4 | D4 | 取消与递补；改名额；截止与开始规则 | C3–C8 连续 20 次稳定；A1 全部通过 |
| S5 | D5 | Next.js 页面与 RPC 客户端 | 手工走通主流程；类型检查通过 |
| S6 | D6 | Playwright；隔离测试补全；日志与错误监控 | E1–E3；A1、I1–I7 全部（I6 同上）；本地 Docker Compose 环境下全部门禁全绿 |
| S7 | D7 | README（含已知限制）、架构图、演示录屏；空库迁移再验一遍 | 干净克隆按 README 能 `docker compose up` 跑起来；CI 记录与录屏可核对 |

### 交付与部署

公网部署不是本周的验收条件，不阻塞任何切片。

**本周必须交付**：

- 公开的项目代码仓库（首次推送前的检查见第 11 节）。
- Docker Compose 本地启动与复现说明。
- 真实 PostgreSQL 的并发与组织隔离测试，以及 CI 运行记录。
- README、架构图、已知限制、完整的演示录屏。
- 录屏展示核心流程（E1–E3 对应的操作）、从干净克隆起 `docker compose up`、C1 跑完后用 SQL 查看数据库最终状态；同时提供可核对的测试结果（CI 记录）。视频不能代替自动化测试。

**可选加分项：公网部署。** 只有找到成本可接受、条款合适，并且实际从中国大陆测试过可访问的方案，才尝试；找不到就按上面的标准交付，不因此推迟项目。没有做公网部署的代价：Secure Cookie 与 HTTPS 下 `trustedOrigins` 在真实域名上的行为没有被验证，README 的已知限制里如实写。

### CI 门禁逐步建立

| 从哪天起 | 新增的必需检查 |
| --- | --- |
| D1 | `vp check`、`vp test`、`next build` |
| D2 | 空库从头迁移、`docker build`、隔离测试 |
| D3–D4 | 并发测试（单独 job，真实 Postgres，重复运行） |
| D6 | Playwright 2–3 条主流程 |

每加一个检查，先故意弄坏一次，确认它会变红再合并。不许为了变绿而新建空测试、删除或弱化测试。

本地统一入口是 `pnpm gate`：D1 定好包结构后创建，从 `vp check`、`vp test`、`next build` 起，之后随上表逐步加入迁移、真实 PostgreSQL 测试等。只在 CI 里跑的检查（例如重复 5 次的并发 job、`docker build`），在 CI 配置和报告里如实标明，不得声称 `pnpm gate` 已经运行了它。

## 11. 非功能要求

- **环境变量**：`DATABASE_URL`、`BETTER_AUTH_SECRET`、`BETTER_AUTH_URL`、`TRUSTED_ORIGINS`、`LOG_LEVEL`、`NODE_ENV`，以及仅服务端使用的 `API_HOST`（本地默认 `127.0.0.1`，Compose 为 `0.0.0.0`）与 `API_INTERNAL_URL`（本地 `http://127.0.0.1:3001`，Compose 为 `http://api:3001`）。用 Zod 在启动时校验，缺失就启动失败。提供 `.env.example`，真实 `.env` 不提交。
- **日志**：结构化 JSON，每条请求记录请求 id、方法、路径、状态码、耗时、用户 id、团队 id。不记录密码、会话令牌、邀请链接。
- **错误监控**：最小接入，D6 选定工具并记入 DECISIONS.md。
- **种子数据**：`pnpm seed` 创建两个团队、若干用户和活动，用于演示。并发测试自己建用户，不依赖种子。
- **邀请链接**：Better Auth 文档提醒邀请 id 等同于可执行的链接，视为机密：不写日志，不进错误监控。
- **公开仓库**：这是公开的求职作品仓库。首次推送前检查：`git ls-files` 里没有 `.env`、密钥、真实用户数据或带密码的连接串；`.env.example` 只含占位值；种子数据全部是虚构的；日志、测试夹具、录屏里不出现真实邮箱或令牌。

## 12. 待定

| 事项 | 谁定、何时 |
| --- | --- |
| 公网部署（可选加分项） | 不阻塞任何切片，不需要在 D1 前选定。仅当找到成本可接受、条款合适、且实际从中国大陆测试过可访问的方案才做；不做则按本地 Docker 交付 |
| 仓库公开还是私有 | 已定：公开（作者，2026-10-13）。公开仓库在 GitHub Free 下可用分支保护（已对照官方文档核实）。新仓库 D1 创建 |
| 工程目录结构 | D1 定，记入 DECISIONS.md。建议 `apps/api`、`apps/web`、`packages/db`、`e2e` |
| 邀请链接能否在不发邮件时跑通 | D2 实测，超过 2 小时退回 BR-2 的直接添加 |
| 错误监控工具 | D6 |
| BR-10 取消活动：保留还是砍掉 | 作者。默认保留，最晚在 D4 的 Sonnet review 之前决定，之后不再改契约。砍掉时的同步清单见第 7 节 |
