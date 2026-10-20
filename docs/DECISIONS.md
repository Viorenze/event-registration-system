# 技术决策记录（DECISIONS）

## 2026-10-20 S0 拆分为两个 PR（S0-A 与 S0-B）

- 选择：将 D1 的 S0 切片拆分为上午 `s0a-skeleton`（S0-A：工作区骨架、本地 PostgreSQL 与连接预算、Drizzle Kit 连库、基础 CI、`pnpm gate`）与下午 `s0b-auth-spike`（S0-B：认证表迁移、API 级登录链路、RPC 与 OpenAPI 最小链路）两个独立分支和两个 PR，每个分支保持单次正式提交。
- 原因：`PRD.md` 第 9 节项 2 要求在上午完成「PR 上基础 CI 全绿」验收，而下午仍需在同一切片阶段继续完成项 4、5、6；拆分为两个 PR 可同时满足上午远程 CI 验收与单分支单次提交的可审计性。该安排是对 `PRD.md` 第 10 节「一个切片一个分支、一次提交」的一次显式批准例外。
- 备选：单个 PR 分两次提交（放弃，违反单分支单次提交规则）。
- 验证：**已验证（约定与分支状态）**——当前 `s0a-skeleton` 仅包含 S0-A 范围产物（A1–A6），未提前纳入 S0-B 的 Better Auth、数据库 schema 或业务接口。

## 2026-10-20 D1 阶段暂不安装 Tailwind CSS 与 shadcn/ui

- 选择：在 D1（S0-A / S0-B）阶段暂不安装 `tailwindcss`、shadcn/ui 及其配套依赖，推迟至 D5（S5 前端页面切片）经依赖批准后再行引入。
- 原因：D1 的六项技术验证均不涉及页面样式或组件库；推迟安装可减少骨架阶段的依赖体积与锁文件复杂度，且不改变 `PRD.md` 与 `AGENTS.md` 锁定的整体技术栈。
- 备选：在 D1 骨架阶段直接安装 Tailwind CSS 与 shadcn/ui（放弃，增加 D1 无关依赖）。
- 验证：**已验证（本地与配置）**——`apps/web/package.json` 仅包含 `next`（`^16.4.2`）、`react`（`^19.3.1`）、`react-dom`（`^19.3.1`）及对应 TypeScript 类型包，未引入样式库依赖。

## 2026-10-20 工作区目录结构、包职责边界与工具链（PRD 第 9 节项 1）

- 选择：采用 `pnpm@12.14.0` workspace 单体仓库结构（要求 Node.js `>=24.11.0`，本机实测 `v24.22.0`），根配置与子包职责边界如下：
  - 根目录：统一管理 `vite-plus`（实测 `vp v1.3.0`，内含 `oxfmt v0.73.0`、`oxlint v1.88.0`、`oxlint-tsgolint v7.0.2004`、`vitest v5.0.5`）、`typescript`（`^7.0.2`）、`tsconfig.base.json`（开启 `strict: true`）与 `vite.config.ts`。
  - `apps/web`（包名 `@event-system/web`）：Next.js `16.4.2` 前端骨架，仅负责界面渲染，不处理认证逻辑；通过 `pnpm --filter @event-system/web build` 执行 `next build`。
  - `apps/api`（包名 `@event-system/api`）：Hono `4.13.13` + `@hono/node-server` + Zod `4.6.7` 后端服务骨架，当前包含根路由占位与 `src/env.ts` 启动期环境变量 Zod 校验（校验 `PRD.md` 第 11 节规定的 `DATABASE_URL`、`BETTER_AUTH_SECRET`、`BETTER_AUTH_URL`、`TRUSTED_ORIGINS`、`LOG_LEVEL`、`NODE_ENV` 六个变量，缺失时仅报告缺失变量名并以非零状态退出）。
  - `packages/db`（包名 `@event-system/db`）：数据库访问与迁移配置包，当前仅包含 `drizzle.config.ts` 与空 schema 入口 `src/index.ts`（`export {};`），S0-A 阶段不建表、不生成迁移文件。
  - 尚未创建的计划目录：`e2e`（Playwright 端到端测试目录，计划于 D6 创建）。
- 原因：满足 `AGENTS.md` 硬规则 1（认证入口只在 Hono，Next.js 只做界面）与硬规则 2（表结构和迁移只由 Drizzle Kit 负责），同时利用 `vite-plus` 统一管理格式、Lint、类型检查与单元测试，无需切换到备选方案。
- 备选：独立安装 `vitest` + `oxlint` + `tsc --noEmit`（未触发，因 `vp check` 与 `vp test` 在含 Next.js 的 workspace 中直接跑通）。
- 验证：**已验证（本地与远程 CI）**——
  - `vp check`：检查范围包含 `apps/web`，通过格式化（21 个文件）与类型感知 Lint/TypeCheck（10 个文件）；在 `apps/web/src/app/page.tsx` 故意引入类型错误的控制实验中，`vp check` 准确报 `TS2322` 并以退出码 `1` 失败，恢复后重新通过。
  - `vp test`：执行 `apps/api/src/env.test.ts` 共 2 个用例（缺少 `DATABASE_URL` 失败、完整变量通过），反转断言的控制实验以退出码 `1` 失败，恢复后重新通过。
  - `pnpm --filter @event-system/web build`：Next.js 16.4.2 生产构建通过，页面构建期错误控制实验变红后已恢复。

## 2026-10-20 基础 GitHub Actions CI 与本地 `pnpm gate`（PRD 第 9 节项 2）

- 选择：
  - 创建 `.github/workflows/ci.yml`，触发条件为 `pull_request`，权限设为最小只读 `permissions: contents: read`。
  - Action 版本策略统一采用官方维护的可移动主版本标签 `@v4`（`actions/checkout@v4`、`pnpm/action-setup@v4` 安装 pnpm `12.14.0`、`actions/setup-node@v4` 配置 Node.js `24` 与 pnpm 缓存；注：`@v4` 为可移动主版本标签，非不可变 commit SHA）。
  - 执行 `pnpm install --frozen-lockfile`，并通过 `echo "$GITHUB_WORKSPACE/node_modules/.bin" >> "$GITHUB_PATH"` 注入工作区本地工具链路径。
  - 将 `vp check`、`vp test`、`pnpm --filter @event-system/web build` 配置为三个独立步骤，不使用 `|| true`、`continue-on-error` 或 `--passWithNoTests`。
  - 在根 `package.json` 创建本地统一门禁脚本 `"gate": "vp check && vp test && pnpm --filter @event-system/web build"`，与 CI 的三项检查步骤一一对应（当前 S0-A 阶段的 `pnpm gate` 不包含任何数据库或迁移检查）。
- 原因：保证本地 `pnpm gate` 与远程 PR 门禁行为一致，且每个检查步骤在 GitHub Actions 中独立可见、失败即阻断。
- 备选：无（`PRD.md` 第 9 节项 2 无备选方案）。
- 验证：**已验证（本地与远程 GitHub Actions）**——
  - 远程一次性验证分支与临时 PR [#1](https://github.com/Viorenze/event-registration-system/pull/1)（已关闭且未合并，临时分支已删除）完成了完整红绿对照：
    1. 初始基线绿灯：Run [`39374831004`](https://github.com/Viorenze/event-registration-system/actions/runs/39374831004)（提交 `5959bdc`）三项检查全部 `success`。
    2. `vp check` 红灯对照：Run [`39375005132`](https://github.com/Viorenze/event-registration-system/actions/runs/39375005132)（提交 `3703d93`）在 `apps/web/src/app/page.tsx` 类型错误下 `Run vp check` 步骤 `failure`（退出码 `1`），证实远程 `vp check` 覆盖 `apps/web`。
    3. `vp test` 红灯对照：Run [`39375222046`](https://github.com/Viorenze/event-registration-system/actions/runs/39375222046)（提交 `89683c7`）在反转 `apps/api/src/env.test.ts` 断言下 `Run vp check` 通过、`Run vp test` 步骤 `failure`（退出码 `1`）。
    4. 恢复后最终绿灯：Run [`39375443433`](https://github.com/Viorenze/event-registration-system/actions/runs/39375443433)（提交 `792d054`）三项检查全部重新 `success`。
    5. 可选的远程 CI `next build` 单独红灯对照未执行（`NOT RUN`；已在本地完成 `next build` 控制实验）。
  - 本地 `pnpm gate`：正向运行退出码 `0`；在 `apps/web/src/app/page.tsx` 引入类型错误时以退出码 `1` 失败；恢复后再次运行退出码 `0`。

## 2026-10-20 Docker Compose PostgreSQL、连接预算与 Drizzle Kit 连库（PRD 第 9 节项 3）

- 选择：
  - `docker-compose.yml` 固定使用官方镜像 `postgres:18.6-alpine`，按 PostgreSQL 18+ 官方规范将命名卷 `postgres_data`（项目级名称 `event-system_postgres_data`）挂载至 `/var/lib/postgresql`。
  - 宿主机端口严格绑定回环地址 `127.0.0.1:${POSTGRES_PORT}:5432`；因本机 `127.0.0.1:5432` 已被既有服务占用，本地开发端口设为 `5433`（即 `127.0.0.1:5433`），并通过环境变量强制要求显式配置 `POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB`、`POSTGRES_PORT`（无弱默认值）。
  - 配置 `pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB` 健康检查，不覆盖镜像默认 `max_connections`。
  - `packages/db/drizzle.config.ts` 显式校验 `process.env.DATABASE_URL`（缺失时抛错），使用 `drizzle-kit`（实测 `v0.31.11`，搭配 `drizzle-orm v0.45.4` 与 `pg`）执行只读 `drizzle-kit pull` 验证连库。
- 原因：隔离宿主机网络与既有 `5432` 端口服务，满足 `PRD.md` 第 8 节对并发测试连接预算（可用连接数 ≥ 76）与第 9 节项 3 不靠建表或手写迁移验证连库的硬性要求。
- 备选：无（`PRD.md` 第 9 节项 3 无备选方案）。
- 验证：**已验证（本地实测）**——
  - 容器与健康检查：`event-system-postgres-1` 状态为 `healthy`，端口映射为 `127.0.0.1:5433->5432/tcp`，本机 `127.0.0.1:5432` 未受影响。
  - 连接预算实测值（容器内 `psql` 实测 `SHOW`）：
    - `server_version`：`18.6`
    - `max_connections`：`100`
    - `superuser_reserved_connections`：`3`
    - `reserved_connections`：`0`
    - 普通用户实际可用连接数：`100 - 3 - 0 = 97`（满足 `≥ 76` 的通过条件，覆盖并发测试池 60 + 观察连接 1 + 应用连接池 ≤ 10 + 临时连接 ≤ 5 = 76 的预算上限）。
  - Drizzle Kit 连库与正负对照：
    - 缺失 `DATABASE_URL` 时失败；
    - 仅替换错误口令（目标 `postgresql://postgres:***@127.0.0.1:5433/event_registration`）时以非零退出码失败，且返回 PostgreSQL 认证失败 `SQLSTATE 28P01`；
    - 使用正确口令执行 `drizzle-kit pull --config=... --out=...` 时退出码 `0`；
    - 连库验证前后四项只读 SQL 检查结果完全一致（非系统表/视图数 `0`、非系统 schema 仅 `public`、`public` 自定义类型数 `0`、`drizzle` 迁移表数 `0`），临时输出目录 `.tmp_drizzle_check` 已清理且无残留。

## 2026-10-20 Better Auth 认证表生成与 Drizzle Kit 迁移（PRD 第 9 节项 5 / S0-B B1）

- 选择：
  - 在 `apps/api` 安装 `better-auth@1.7.11` 与 `@event-system/db@workspace:*`；`apps/api/src/auth.ts` 配置 `drizzleAdapter(db, { provider: "pg", schema: authSchema })`、`emailAndPassword: { enabled: true }` 与 `organization({ disableOrganizationDeletion: true })`（不启用 Teams；已核实 `better-auth@1.7.11` 类型定义 `dist/plugins/organization/types.d.mts` 第 618 行精确属性名为 `disableOrganizationDeletion?: boolean`）。
  - 使用官方 CLI `npx --yes auth@1.7.11 generate --config ./apps/api/src/auth.ts --output <temp> -y` 生成 `packages/db/src/auth-schema.ts`（与 CLI 原始生成文件 `0` diff），并在 `packages/db/src/index.ts` 统一导出 `createDb`（`pg.Pool` 连接池 `max: 10`）、`authSchema` 及全部表定义。
  - 严格执行 `AGENTS.md` 硬规则 2：不运行 Better Auth 自带的 `migrate`，统一由 `drizzle-kit@0.31.11` 运行 `drizzle-kit generate --config=drizzle.config.ts --name=auth_tables` 生成 `packages/db/drizzle/0000_auth_tables.sql`（SHA-256: `05A9F5572E27EDB0497F9E7FFF3E8569AA77E770528E64926238B3C046F14820`）及 `meta/_journal.json`、`meta/0000_snapshot.json`。
  - **`disableOrganizationDeletion: true` 与 `ON DELETE CASCADE` 的职责边界（重要约束）**：`disableOrganizationDeletion: true` 仅在 Better Auth 的 HTTP 路由层生效（拦截 `/api/auth/organization/delete` 并返回 `ORGANIZATION_DELETION_DISABLED`），不是数据库级的删除保护；`0000_auth_tables.sql` 中的 6 条外键全部带有 `ON DELETE CASCADE`，若直接对数据库执行 `DELETE FROM public.organization` 或 `DELETE FROM public."user"`，PostgreSQL 会级联删除关联的 `member`、`invitation`、`session`、`account` 记录。因此应用层严禁直接执行组织或用户的 SQL 物理删除；后续在 S1 设计业务表（`events`、`registrations`、`audit_logs`）外键策略时，必须重新审视级联策略，防止误删组织或用户导致活动、报名或审计日志被静默级联清除。
- 原因：保证表结构与迁移由 Drizzle Kit 唯一管理，并确保 `user.id` 与 `organization.id` 主键类型为 `text`，与 `PRD.md` 第 5.1 节锁定的业务表外键类型一致。
- 备选：无（`PRD.md` 第 9 节项 5 无备选方案）。
- 验证：**已验证（SQL 审批 + 临时库 `migration_check` 演练与清理 + 开发库 `event_registration` 迁移）**——
  - 生成的 `0000_auth_tables.sql` 经人工审阅并按精确 SHA-256（`05A9F5572E27EDB0497F9E7FFF3E8569AA77E770528E64926238B3C046F14820`）获批。
  - 临时库 `migration_check`（`127.0.0.1:5433`）：创建前确认不存在；首次 `drizzle-kit migrate` 成功创建 7 张表（`account`、`invitation`、`member`、`organization`、`session`、`user`、`verification`），主键 `id` 均为 `text NOT NULL`，3 个唯一约束（`organization_slug_unique`、`session_token_unique`、`user_email_unique`）、6 个外键（`ON DELETE CASCADE`）、7 个 `btree` 二级索引全部匹配，`drizzle.__drizzle_migrations` 仅含 1 条记录（`id=1`，`hash=05a9f5572e27edb0497f9e7fff3e8569aa77e770528e64926238b3c046f14820`）；重复执行 `drizzle-kit migrate` 幂等通过（仍为 7 张表、1 条记录）；再次执行 `drizzle-kit generate` 输出 `No schema changes, nothing to migrate`（无新增文件、无 schema drift）；确认 7 张表行数为 `0` 后执行 `DROP DATABASE migration_check` 并验证已删除。
  - 开发库 `event_registration`（`127.0.0.1:5433`）：单独获批后核验 SQL SHA-256 一致、迁移前非系统表数为 `0`；执行首次 `drizzle-kit migrate`、7 张表/主键/唯一约束/6 个外键/7 个二级索引核验、`drizzle.__drizzle_migrations` 单条记录核验、二次 `drizzle-kit migrate` 幂等核验、二次 `drizzle-kit generate` 零漂移核验，全部通过。
  - Windows 备注：在 Windows 下通过 `pnpm.cmd --filter ... exec node -e "<多行脚本>"` 会触发批处理参数解析错误，改在子包目录下直接调用 `node --env-file=../../.env -e "<单行脚本>"` 运行 `./node_modules/drizzle-kit/bin.cjs` 可稳定执行。

## 2026-10-20 API 级认证链路与 Next.js 同源代理（PRD 第 9 节项 4 / S0-B B2）

- 选择：
  - 采用主方案（Next.js 同源代理）：`apps/web/next.config.ts` 配置 `rewrites()` 将 `/api/:path*` 转发至 `http://127.0.0.1:3001/api/:path*`。
  - `apps/api/src/index.ts` 挂载 `.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw))`；使用 `if (import.meta.main)` 守卫 `serve({ fetch: app.fetch, hostname: "127.0.0.1", port })`，确保导入 API 模块不会意外启动监听器。
  - `apps/api/src/env.ts` 新增 `parseTrustedOrigins`（含 `apps/api/src/env.test.ts` 单元测试），拒绝通配符 `*`、空值或非精确 origin；本地开发 `BETTER_AUTH_URL` 与 `TRUSTED_ORIGINS` 均设为 `http://localhost:3000`。
- 原因：遵守 `AGENTS.md` 硬规则 1（认证入口只在 Hono，Next.js 只做界面），通过同源代理使前端与 `/api/auth/*` 处于同一 Origin（`http://localhost:3000`），避免跨域 Cookie 与 CORS 风险。
- 备选：浏览器直接跨域请求 Hono + `hono/cors`（未触发，同源代理主方案直接通过）。
- 验证：**已验证（模块导入无副作用检查 + `curl.exe` 同源代理全链路 + PostgreSQL 状态断言）**——
  - 模块导入检查：动态 `import('./apps/api/src/index.ts')` 后实测 `127.0.0.1:3001` 端口仍空闲可绑定，确认无监听副作用。
  - 未登录查会话：`GET http://localhost:3000/api/auth/get-session` 返回 HTTP `200`、响应体 `null`。
  - 非法 Origin 拒绝：带 `Origin: http://evil.example.com` 调用 `POST http://localhost:3000/api/auth/sign-up/email` 返回 HTTP `403`（`{"message":"Invalid origin","code":"INVALID_ORIGIN"}`），数据库 `user` 表保持 `0` 行。
  - 可信 Origin 注册与 Cookie 属性（值已脱敏）：带 `Origin: http://localhost:3000` 注册 `b2-test@example.com` 返回 HTTP `200`；`Set-Cookie` 属性实测为 `better-auth.session_token=[REDACTED]; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax`（HTTP 开发环境下不含 `Secure`）。
  - 查会话与数据库验证：带 Cookie 调用 `GET http://localhost:3000/api/auth/get-session` 返回匹配的用户与会话；数据库 `user`、`session`、`account`（`provider_id = 'credential'`）各为 `1` 行。
  - 登出与服务端失效验证：调用 `POST http://localhost:3000/api/auth/sign-out` 返回 HTTP `200`（`{"success":true}`），下发 `Max-Age=0` 清除 Cookie；登出后无论使用更新后的 Cookie 文件还是重放登出前备份的旧会话 Cookie 调用 `get-session` 均返回 `null`，数据库 `session` 表行数变为 `0`。
  - 清理确认：确认测试账号身份后删除 `b2-test@example.com`，`user`、`session`、`account` 行数全部归零（`0` 行），仓库外 `$env:TEMP` 临时文件已删除。

## 2026-10-20 Hono RPC 与 `@hono/zod-openapi` 最小链路及示例路由去留（PRD 第 9 节项 6 / S0-B B3）

- 选择：
  - 采用主方案（Hono RPC `hc<AppType>` + `@hono/zod-openapi`）：`apps/api` 安装 `@hono/zod-openapi@^1.6.3`（锁定 `1.6.3`），在 `apps/api/src/index.ts` 使用 `OpenAPIHono` 与 `createRoute` 链式挂载 `GET /api/health`（必填 query 参数 `echo: z.string().min(1)`，返回 `200 { status: "ok", echo }`）及 `GET /doc`（输出 OpenAPI `3.0.0` JSON），导出 `export type AppType = typeof app;`。
  - 链式顺序约束：`OpenAPIHono` 的 `.openapi(...)` 与 `.doc(...)` 需置于基础 `Hono` 方法（`.get(...)`、`.on(...)`）之前调用，以保留 `OpenAPIHono` 实例类型与完整的 `AppType` 路由推导。
  - `apps/web` 安装 `hono@^4.13.13` 与 `@event-system/api@workspace:*`（`devDependencies`，仅 `import type { AppType }`），在 `apps/web/src/lib/api-client.ts` 中使用 `hc<AppType>("/")` 封装 `fetchApiHealth`。
  - **示例路由 `/api/health` 与 `/doc` 的去留决定**：当前作为 S0-B 技术验证产物及 `apps/api/src/index.test.ts` 的被测路由保留，**不升级为正式业务接口，且未经显式批准绝不列入 I5 路由表豁免清单**；在 D2（S1）引入正式业务路由与 I5 路由表完整性测试前，除非用户明确批准豁免，否则应予以移除或替换。
- 原因：无需额外代码生成步骤即可打通后端 Zod OpenAPI 路由定义与前端编译期类型安全调用。
- 备选：`openapi-typescript`（未触发、未安装）。
- 验证：**已验证（`pnpm why hono` + TDD 单元测试 + 负向类型检查控制实验 + `pnpm gate`）**——
  - `pnpm why hono`：全工作区仅解析唯一版本 `hono@4.13.13`。
  - 单元测试：`apps/api/src/index.test.ts` 先写失败测试（3 用例 404 变红），实现后 `GET /api/health?echo=ping`（`200`）、缺失参数（`400`）与 `GET /doc`（OpenAPI `3.0.0` 含 `/api/health`）全部变绿。
  - 负向类型控制实验：在 `apps/web/src/lib/api-client.ts` 将 `query: { echo }` 改为 `query: { echo: 123 }` 时，`vp check` 报 `typescript(TS2322): Type 'number' is not assignable to type 'string'` 并失败；恢复后 `vp check` 与 `pnpm gate` 全绿。

## 2026-10-20 S0-B 未验证范围与已知限制

- 浏览器 UI 登录、创建团队与邀请交互：S0-B 仅完成 `curl.exe` API 级验证，浏览器端交互留待 D2（S1）及 D6（Playwright）验证。
- HTTPS 与 `Secure` Cookie 属性：本地开发为 HTTP（`http://localhost:3000`），`Secure` 属性未验证。
- `.agents/rules/db.md` 会话触发验证（B4）：按计划属于可选验证，本次未单独执行会话触发实验（状态：未验证）。
- CI 中的 PostgreSQL 与迁移门禁：当前 `.github/workflows/ci.yml` 与 `pnpm gate` 仅运行 `vp check`、`vp test`、`pnpm --filter @event-system/web build`，真实 PostgreSQL 测试与迁移门禁按 `PRD.md` 第 10 节于 S1 接入。
