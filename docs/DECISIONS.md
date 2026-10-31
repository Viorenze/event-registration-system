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

## 2026-10-21 S1 组织权限中间件架构方案（方案 H）与类型推断保护

- 选择：
  - 采用中间件方案 H（前缀级中间件 + 路由级角色检查）：
    - 在 `apps/api/src/auth-middleware.ts` 实现 `requireOrgMember`（前缀级，挂载于 `/api/orgs/:orgId/*`）与 `requireOrgRole(minRole)`（路由级）。
    - 中间件优先从 URL 路径参数 `:orgId` 获取组织 ID（不用 `activeOrganizationId`），查询当前用户在 `member` 表中的真实成员记录，并将 `authContext: { user, session, member }` 注入 Hono 上下文 `c.set(...)`。
    - 针对 `@hono/zod-openapi` 中 `app.use(...)` 会破坏 `app.openapi(...)` 链式调用返回类型、导致 `AppType` 坍缩为 `any` 的已知问题，采用「基础 OpenAPI 应用分离并独立应用中间件」架构（`baseApp = new OpenAPIHono()`，中间件挂载在 `baseApp.use(...)`，路由通过 `baseApp.openapi(...)` 注册，最终导出 `export type AppType = typeof baseApp;`）。
  - 在 `apps/web/src/types/api-client-guard.ts` 实现类型守卫，静态断言 `NotAny`、`Equal<Arg["param"]["orgId"], string>`，并通过 `@ts-expect-error` 断言类型安全。
- 原因：符合 `AGENTS.md` 硬规则 3（先过权限中间件、每条查询带 `organization_id`），同时保证 OpenAPI 路由类型推导完整，杜绝 `any` 坍缩。
- 备选：纯路由级中间件（方案 P，容易漏写导致裸路由）；集中式中间件（方案 S，缺乏路由级微调能力）。
- 验证：**已验证（通过）**——`isolation.integration.test.ts` 9 项真实数据库集成测试全绿；4 项负向变异控制实验（跳过登录、跳过成员关系、降低角色阈值、未注册路由未进豁免）全部如期变红；`vp check` 与 `api-client-guard.ts` 编译期类型校验通过。

## 2026-10-21 S1 邀请路径实测（I6）与 BR-2 回退未触发判定

- 选择：
  - 使用 Better Auth 原生 `organization` 插件的邀请机制（端点：`POST /api/auth/organization/invite-member` 与 `POST /api/auth/organization/accept-invitation`）。
  - 创建邀请调用成功直接返回 `{ id: string }`，无需从服务端日志读取邀请凭证；邀请创建与接收端点均不输出、不记录邀请凭证或链接。
  - 实测耗时不足 5 分钟，远低于 2 小时时间盒阈值，直接跑通，**不触发 BR-2 降级回退**。
- 原因：原生邀请机制功能完整且满足安全性与时限要求。
- 备选：BR-2 直接加成员回退接口 `POST /api/orgs/:orgId/members`（未触发）。
- 验证：**已验证（通过）**——`invitation-i6.integration.test.ts` 实测通过：
  - 拒绝用例先于成功用例执行：非成员创建邀请返回 HTTP `400`（`MEMBER_NOT_FOUND`）；普通成员创建邀请返回 HTTP `403`（`YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION`）；邮箱不匹配的用户接受邀请返回 HTTP `403`（`YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION`），数据库无新增记录。
  - 对照组成功用例：Owner 创建邀请返回 HTTP `200`（含 `id`）；匹配邮箱登录用户接受后返回 HTTP `200`，数据库 `member` 表新增匹配行且角色为 `member`。

## 2026-10-21 S1 团队管理权限（I7）实测状态码与 I7(b) 部分验证口径

- 选择与实测状态码：
  - I7(a)：未登录创建组织返回 HTTP `401`；登录用户创建组织成功返回 HTTP `200`，并在 `member` 表中自动赋予 `owner` 角色。
  - I7(b)：组织删除已被插件参数 `disableOrganizationDeletion: true` 显式禁用。实测 Owner 调用删除接口返回 HTTP `404`（`ORGANIZATION_DELETION_DISABLED`），数据库 `organization`、`member`、`invitation` 行数完全未变。
    - **口径声明**：因 D2 阶段尚未创建 `events` 业务表，无法对「活动关联数据未被删除」进行真实物理断言，因此 I7(b) 最终状态严格标定为**「部分验证」（partially verified）**，不拿 0 对 0 充数；活动关联数据保护断言延后至 D3。
  - I7(c)：普通成员及非组织成员尝试修改/移除目标成员时，分别返回 HTTP `403`（`YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER` / `YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER`）或 `400`（`MEMBER_NOT_FOUND`），数据库状态未变；Owner 对照组操作成功。
  - I7(d)：Admin 尝试将 Owner 降级为 Member，返回 HTTP `403`（`YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER`）；Admin 尝试移除 Owner，返回 HTTP `400`（`YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER`），数据库状态完全未变。
- 原因：如实记录 `better-auth@1.7.11` 的原生 HTTP 状态码与业务边界。
- 验证：**已验证（I7(a)(c)(d) 通过，I7(b) 部分验证）**——`team-management-i7.integration.test.ts` 全部通过。

## 2026-10-21 `/doc` 与 `/api/health` 路由保留与豁免口径说明

- 选择：
  - `/doc` 路由保留并显式列入 `routes-exemptions.ts` 豁免清单。
  - `/api/health` 保留并显式列入 `routes-exemptions.ts` 豁免清单。
- 差异与证据解释：
  - S0-B 决策曾记录「除非用户明确批准豁免，否则应予以移除或替换」。
  - 本轮依据 `AGENTS.md` 首行原则「事实来源是 PRD.md。任务与 PRD.md 冲突，或超出它的范围，停下来问我，不要自行决定。标『【锁定】』的内容不经我同意不得改。」
  - `PRD.md` 第 7 节 I5 初始豁免清单明确包含：`/api/health`、`/doc`、`/api/auth/*`。
  - 此外，Docker Compose 中 API 容器的健康检查依赖 `GET http://127.0.0.1:3001/doc` 返回 200，遵守了「不为健康检查新增路由」的硬规则。因此保留 `/doc` 路由并列入豁免清单完全符合锁定 PRD、AGENTS 及 Docker 运行时要求。

## 2026-10-21 浏览器注册、登录、会话与登出 HTTP 实测（T5）

- 选择：
  - 在 `apps/web/src/app/page.tsx` 实现最小无样式客户端组件，原生调用同源 `/api/auth/*`，携带 `credentials: "include"`，不引入外部组件库或新依赖。
  - 验收环境严格基于 Docker Compose 全栈运行（Web 监听 `127.0.0.1:3000`，同源代理至 API `http://api:3001`，真实 PostgreSQL 容器运行）。
- 验证：**已验证（HTTP 下手工通过）**——
  - 初始数据库：`user: 0, session: 0, account: 0`。
  - 注册：`POST /api/auth/sign-up/email` 返回 HTTP `200`，下发 Cookie（`Max-Age=604800; Path=/; HttpOnly; SameSite=Lax`，脱敏），数据库各增 1 行（`user: 1, session: 1, account: 1`）。
  - 读会话：`GET /api/auth/get-session` 返回 HTTP `200`，用户邮箱匹配。
  - 刷新会话：再次读取 `GET /api/auth/get-session` 会话正常维持。
  - 退出登录：`POST /api/auth/sign-out` 返回 HTTP `200`，下发清理 Cookie（`Max-Age=0`）；再次读取会话返回 `null`；数据库 `session` 行数减 1 归零（`session: 0`），`user` 与 `account` 保持为 1。
  - 结论口径严格记录为「HTTP 下手工通过」，不声称已验证 Secure Cookie、HTTPS 或 Playwright。

## 2026-10-21 Docker Compose 全栈编排与构建时配置（T6）

- 选择：
  - API 与 Web 各自建立精简 Dockerfile。
  - API 监听地址支持环境变量 `API_HOST`（本地 `127.0.0.1`，容器 `0.0.0.0`）。
  - 针对 Next.js `rewrites()` 在构建期将目标 URL 固化至 `.next/routes-manifest.json` 的特性，在 `apps/web/Dockerfile` 中配置构建参数 `ARG API_INTERNAL_URL=http://api:3001`，确保容器内部同源代理精确指向 API 容器。
  - Web 构建复用 API 基础镜像层与 pnpm 存储，使 Web 构建耗时由 6 分钟优化至 15 秒，避免 Docker named pipe 争用超时。
  - `docker-compose.yml` 严格依据健康状态编排：`postgres` (健康检查 `pg_isready`) -> `migrate` (一次性迁移，`service_completed_successfully`) -> `api` (健康检查 `/doc`，`service_healthy`) -> `web`。
- 验证：**已验证（通过）**——`docker compose up -d` 全流程成功，迁移退出码 0，API 报告 healthy，Web 成功提供前端页面并代理认证请求。

## 2026-10-21 本地 `pnpm gate` 与 GitHub Actions CI 检查升级（T7）

- 选择：
  - 本地 `pnpm gate` 升级为：`vp check && vp test && pnpm test:integration && pnpm --filter @event-system/db verify:migration && pnpm --filter @event-system/web build`。数据库不可达时立即非零退出，不自动启动 Docker。
  - GitHub Actions 配置 4 个独立 Job（包含 3 个新增 check context）：
    1. `ci`：现有门禁（`vp check`、`vp test`、`next build`）；
    2. `integration-tests`：启动 PostgreSQL 容器，执行真实数据库集成测试；
    3. `empty-db-migration`：启动 PostgreSQL 容器，验证从空库初始迁移、二次幂等迁移、迁移记录数与 journal 动态对齐、全部 schema 表存在性核验，以及 `drizzle-kit generate` drift 超时防挂起检查；
    4. `docker-build`：分别独立构建 API 与 Web 镜像（明确标明仅在 CI 运行，不包含在 `pnpm gate` 中）。
- 验证：**已验证（通过）**——本地 `pnpm gate` 退出码 0；连接不可达时退出码 1。

## 2026-10-21 D2 已知限制与未验证项

- GitHub 分支保护 API 配置（T8a/T8b）：
  - 只读检查已获取：`GET /repos/.../branches/main/protection` 返回 HTTP `404 Branch not protected`，rulesets 返回 `[]`。
  - 写入操作受阻：配置分支保护（`PUT /protection`）与创建 Ruleset（`POST /rulesets`）均返回 HTTP `403 Resource not accessible by personal access token`。核查表明当前 Fine-Grained PAT 具有内容与 PR 读写权限，但未被授予仓库 `Administration: Read & Write` 权限。按 D2 计划与委托规则，本项如实记录为权限受阻，待管理员授权后闭环。
- `events` 级联删除保护断言（I7(b)）：D2 未建 `events` 业务表，延后至 D3。
- 业务接口 400 校验缺失：D2 移除了 health 路由参数测试，当前无业务路由产生 400 校验错误，延后至 D3。
- HTTPS、Secure Cookie 及 Playwright 测试：延后至 D6 整体端到端切片。

## 2026-10-21 D2 独立验收后决策记录纠正与事实对齐（DEV-D2-01 / DEV-D2-02 / G2–G4）

### 1. DEV-D2-01 纠正：`/api/health` 路由实际删除与豁免清单范围更正

- 历史记录回顾：前节「`/doc` 与 `/api/health` 路由保留与豁免口径说明」曾记录“`/api/health` 保留并显式列入 `routes-exemptions.ts` 豁免清单”。
- 实际实施事实更正：在提交 `65b4380` 中，依据 `D2_PLAN.md` 第 186 行（“同一提交内完成：删除 `GET /api/health`、`GET /`、2 个 health 测试”）及第 356 行已获委托决策，在 `apps/api/src/index.ts` 中**彻底删除了 `/api/health` 与 `GET /` 路由**，在 `apps/api/src/index.test.ts` 中删除了对应的 2 个参数与响应单测，并将 `/doc` 单测断言指向成员路由。
- 当前实际豁免清单：`apps/api/src/routes-exemptions.ts` 严格仅包含 3 项：
  1. `POST /api/auth/*`
  2. `GET /api/auth/*`
  3. `GET /doc`
  代码中**不存在 `/api/health` 路由**，豁免清单中亦无 `/api/health`。API 容器在 Docker Compose 中的健康检查使用 `GET http://127.0.0.1:3001/doc`（返回 HTTP 200），遵守“不为健康检查新增路由”的约束。

### 2. DEV-D2-02 纠正：GitHub 分支保护 8a/8b 最终配置与验证闭环

- 历史记录回顾：前节「D2 已知限制与未验证项」中记录“写入操作受阻……返回 HTTP 403……待管理员授权后闭环”，该记录反映了提交 `65b4380` 创建时 PAT 尚未开通管理员权限的真实中间状态。
- 最终配置与验证事实（严格区分 CI 结论、分支保护拦截与 PR 未合并三个事实）：
  1. **管理员授权生效**：在提交 `65b4380` 后、PR #4 流程中，仓库管理员为 PAT 补充了必要权限；
  2. **8a（合并前保护）**：在 PR #4 合并前成功调用 GitHub API 配置保护，设置必需检查为 `ci`，并启用管理员强制执行（`enforce_admins: true`）；
     - 临时 PR [#5](https://github.com/Viorenze/event-registration-system/pull/5)（分支 `temp-red-control`）验证结果：
       - **CI 运行结论**：CI Run [`39609051364`](https://github.com/Viorenze/event-registration-system/actions/runs/39609051364) 的 4 个 Job 全部失败（`conclusion: failure`）；
       - **分支保护拦截状态**：GitHub API 记录 PR #5 的 `mergeable: true` 且 `mergeable_state: "blocked"`，证明分支保护规则生效并主动阻断合并；
       - **PR 最终状态**：验证后由人工显式关闭，未发生合并（`state: "closed"`, `merged: false`, `merged_at: null`），临时分支已删除；
  3. **PR #4 合并**：PR [#4](https://github.com/Viorenze/event-registration-system/pull/4) 正向 CI Run [`39608522315`](https://github.com/Viorenze/event-registration-system/actions/runs/39608522315) 4 个 Job 全部成功，于 2026-10-21T13:36:57Z 顺利合并至 `main`（merge commit `65b4380`）；
  4. **8b（合并后保护）**：合并后立即将必需状态检查列表完整升级为 4 个独立 check context：
     - `ci`
     - `integration-tests`
     - `empty-db-migration`
     - `docker-build`
     保留 `strict: true`（要求分支在合并前与主干同步）与 `enforce_admins: true`；
     - 临时 PR [#6](https://github.com/Viorenze/event-registration-system/pull/6)（分支 `temp-verify-8b`）引入类型错误验证结果：
       - **CI 运行结论**：CI Run [`39609734614`](https://github.com/Viorenze/event-registration-system/actions/runs/39609734614) 失败（`ci` 与 `docker-build` 失败，`conclusion: failure`）；
       - **分支保护拦截状态**：GitHub API 记录 PR #6 的 `mergeable: true` 且 `mergeable_state: "blocked"`，证明 8b 保护规则生效并阻断合并；
       - **PR 最终状态**：验证后由人工显式关闭，未发生合并（`state: "closed"`, `merged: false`, `merged_at: null`），临时分支已删除；
  5. **当前远端防护状态核验**：
     - **公共 API 查询**（`GET /repos/.../branches/main`）：直接证实 `protected: true`、`enforcement_level: "everyone"`，必选 context 列表包含上述 4 项；
     - **鉴权 API 查询**（`GET /repos/.../branches/main/protection/required_status_checks` 与 `/enforce_admins`）：直接证实 `strict: true` 且 `enforce_admins.enabled: true`。

### 3. RPC 类型守卫 G1–G4 验证状态明确与证据缺口登记

- **G1（已验证 / PASS）**：在 S1 中间件开发阶段，当 `OpenAPIHono.use()` 破坏链式类型推导导致 `Arg` 退化为 `any` 时，`apps/web/src/types/api-client-guard.ts` 中的 `// @ts-expect-error` 成为多余指令，`vp check` 准确报出 `TS2578: Unused '@ts-expect-error' directive` 并使门禁失败（见会话步骤 449 历史记录），恢复分离式中间件挂载后重新通过。
- **G2–G4（未验证 / UNVERIFIED，正式登记为证据缺口）**：
  - G2（`AppType` 故意退化为 `any`、`unknown`、`{}` 的独立负向控制实验）；
  - G3（故意使用错误路径参数键以验证类型守卫红灯的实验）；
  - G4（仅由 CI 中 `next build` 捕获的专属红对照实验）；
  - **现状澄清**：上述 G2、G3、G4 负向实验在 D2 执行期间未在会话轨迹中独立执行与留痕。虽然静态守卫文件 `apps/web/src/types/api-client-guard.ts` 包含 `NotAny`、`P1`、`n1` 并在 `vp check` 中正常编译，但**不得**将“守卫文件存在或门禁全绿”等同于 G2–G4 负向控制已通过；在此如实标为“未验证 / 证据缺口”：证据缺口本身不证明存在缺陷，但相关守卫有效性仍未得到独立验证。后续是否补做实验，由 D3 计划结合原有停止规则统筹评估。

## 2026-10-23 S2-1 设计决策收敛与 K1 验证环境闭环（DEV-S2-01 至 DEV-S2-05）

### 1. DEV-S2-01 活动标题长度 API 校验与 PRD BR-3 锁定规则对齐

- 选择：在 API 路由层（`apps/api`）的请求体 Zod Schema 校验中，活动标题严格采用 `title: z.string().trim().min(1, "title is required").max(120, "title too long")`。
- 原因：直接与 `PRD.md` §3 锁定业务规则 BR-3（“活动字段：标题（1–120 字）……”）对齐。`PRD.md` §5 数据库定义锁定为 `text, 非空`，底层不作长度截断，物理完整性与业务规则在 API 校验层无缝对齐。
- 边界澄清：请求体字节数限制（HTTP body size limit）属于服务层/中间件独立的传输层输入大小防护，用于防止超大 JSON 请求体引发内存耗尽（DoS），绝不能代替业务字段的字符长度校验，也不能以字段 `.max()` 宣称完成了请求体大小限制。
- 备选：API 层采用 `max(255)` 或移除上限（放弃，放行 121–255 字会直接破坏 PRD BR-3 业务契约）。

### 2. DEV-S2-02 `events.organization_id → organization.id` 外键动作设计

- 选择：外键动作显式声明为 `ON DELETE RESTRICT` 与 `ON UPDATE NO ACTION`。
- 原因：
  - `ON DELETE RESTRICT`：禁止直接物理删除仍被活动引用的组织，保护活动历史记录、关联报名及避免破坏 INV-2；在应用层拦截物理删除之外，在数据库底层提供物理删除保护。
  - `ON UPDATE NO ACTION`：组织主键 ID 为唯一标识符，无业务轮换或更新需求，不开放不必要的级联更新。
- 规范澄清：记录这是针对 `PRD.md` §5 未规定的外键动作作出的设计工程选择，而非声称 PRD 已明确锁定。测试夹具的清理须严格按依赖顺序逆序执行或通过整库销毁解决，严禁依赖级联删除。

### 3. DEV-S2-03 `events.created_by → user.id` 外键动作设计

- 选择：外键动作显式声明为 `ON DELETE RESTRICT` 与 `ON UPDATE NO ACTION`。
- 原因：
  - `ON DELETE RESTRICT`：活动创建者仍被活动引用时，拒绝直接删除该用户，避免活动历史及其关联业务数据被连带级联破坏。
  - `ON UPDATE NO ACTION`：用户主键 ID 无业务更新需求。
- 规范澄清：`created_by` 为非空列（`NOT NULL`），故 `ON DELETE SET NULL` 物理不适用；`ON DELETE CASCADE` 会造成连带删除风险，予以排除。测试清理必须按依赖树逆序执行。

### 4. DEV-S2-04 `updated_at` 维护机制与保证边界

- 选择：当前阶段采用 Drizzle ORM 的 `$onUpdate(() => new Date())` 管理应用层/ORM 更新路径，不新增数据库触发器，不手写迁移。
- 原因：完全符合 `AGENTS.md` 硬规则 2（表结构和迁移只由 Drizzle Kit 负责，不手写迁移），且与 `auth-schema.ts` 既有做法保持一致。
- 保证边界与限制：必须明确记录，Drizzle 的 `$onUpdate()` 仅对经由 Drizzle Query Builder（`db.update()`）发起的更新操作生效；绕过 ORM 的原生 SQL 更新或外部批处理不会自动刷新该时间戳。不得宣称其具备数据库底层的全局物理更新时间保证。当前业务路径全部经由 ORM，满足需求。

### 5. DEV-S2-05 K1 数据库约束测试分阶段验收与 DML 授权缺口确认

- 选择：
  - S2-2 阶段仅编写测试资产与进行必要的静态源码编译检查（`vp check`），**不连接数据库，不通过执行预期失败的 SQL 来探测 `42P01`**；
  - 数据库依赖的 K1 用例在 S2-2 严格标记为 **`NOT RUN / UNVERIFIED`**，理由为物理 schema 尚未按既定流水线建立（迁移生成在 S2-3），且当前授权未覆盖其 DML；S2-2 的静态检查不得冒充数据库行为验收。
  - 真实的 PostgreSQL K1 验证（正向落库、违规 DML 拒绝、SQLSTATE、约束名/列名精确断言）安排在 S2-4a 一次性库正式迁移及目录核对之后执行。
  - 授权边界与缺口登记：现有 AU-2 文本仅授权了一次性库的“创建、DDL、销毁”及迁移核对，未明确授权测试套件所需的 fixture 插入与违规 DML 写入。保留此操作授权缺口；在作者单独批准 K1 DML 范围之前，严禁执行这些操作。持久开发库迁移仍需独立的 `AR-S2-APPLY` 授权，不得与一次性库授权混淆。

## 2026-10-25 S2 切片实现落地与验收记录（DEV-S2-06 至 DEV-S2-09）

### 1. DEV-S2-06 外键动作确定（DEV-S2-02 与 DEV-S2-03 落地生效）
- 决定：`events.organization_id → organization.id` 与 `events.created_by → user.id` 外键动作显式声明为 `ON DELETE RESTRICT, ON UPDATE NO ACTION`。
- 依据：已在迁移 `0001_events.sql` 中生成并在 catalog 核对（`confdeltype = 'r'`, `confupdtype = 'a'`），测试通过正向落库与直接 SQL `DELETE` 拒绝验证。
- 清理策略：测试清理严格按逆序依赖清理或整库销毁，严禁依赖级联。

### 2. DEV-S2-07 PRD §7 偏差确认（活动列表计数移至 S3）
- 偏差内容：PRD §7 的 `GET /api/orgs/:orgId/events` 在 S2 切片中不返回 `confirmedCount` 与 `waitlistedCount`，也不返回伪造的 0。
- 依据：已获作者明确同意，并在 PRD §7 非锁定描述中加注“（确认数、候补数自 S3 起返回）”。该两项计数在 S3 切片结合报名字段与并发计数统一返回。

### 3. DEV-S2-08 数据库层保护边界已知限制说明
- 现状与边界：`events.organization_id → organization.id` 的 `ON DELETE RESTRICT` 仅在目标组织名下**存在至少 1 个活动**时提供物理层面的硬删除防护。
- 限制澄清：对于尚未创建任何活动的新建组织或空组织，数据库外键不会阻止对其直接执行 `DELETE FROM organization`。此时组织删除防护仅由应用层 Better Auth 插件的 `disableOrganizationDeletion: true` 配置拦截（返回 404 `ORGANIZATION_DELETION_DISABLED`）。这属于设计上的已知边界与限制。

### 4. DEV-S2-09 500 故障注入验证与未验证项清单
- **500 故障注入映射（已验证 / PASS）**：在 `events.integration.test.ts` 中针对 `POST /api/orgs/:orgId/events`（通过 `vi.spyOn(db, "transaction")` 注入底层事务异常）与 `GET /api/orgs/:orgId/events`（通过 `vi.spyOn(db, "select")` 注入底层查询异常）分别执行测试，断言均稳定返回 HTTP 500 `{ error: { code: "INTERNAL_ERROR", message: "..." } }`，且返回错误信息完全脱敏，严格不泄露 SQL 语句、内部表名、连接串或数据库密码。全局 `baseApp.onError` 亦作为未捕获异常的安全防线生效。
- **G2–G4 负向类型守卫实验（未验证 / UNVERIFIED）**：沿用 D2 记录，G2（AppType 故意退化为 any/unknown/{}）、G3（错误路径参数键类型报错）、G4（仅由 next build 捕获的专属红对照）仍保留为未验证缺口。当前已在 `api-client-guard.ts` 中增加对 `PostEventsArg["json"]` 的强类型与负向 `@ts-expect-error` 断言。

## 2026-10-27 S3 切片设计决策、变异实验与落地记录（DEV-S3-01 至 DEV-S3-09）

### 1. DEV-S3-01 `registrations` 两个外键用 `RESTRICT` 及设计理由
- 决定：`registrations` 表的两条外键动作均显式声明为 `ON DELETE RESTRICT, ON UPDATE NO ACTION`：
  1. `registrations_event_org_fk`: FOREIGN KEY `(event_id, organization_id)` REFERENCES `events(id, organization_id)` ON DELETE RESTRICT
  2. `registrations_user_id_fk`: FOREIGN KEY `(user_id)` REFERENCES `"user"(id)` ON DELETE RESTRICT
- 理由：
  - `registrations_event_org_fk`: 禁止直接物理删除仍有关联报名的活动及组织，确保报名历史数据与审计追踪完整，防止孤儿数据产生。
  - `registrations_user_id_fk`: 禁止直接物理删除仍有报名记录的用户。若采用 `ON DELETE CASCADE`，当目标用户被删除时，数据库会无声级联删除其报名记录，绕过应用层事务与递补逻辑，直接导致确认人数低于容量且候补队列仍存在未被递补的成员，破坏核心业务不变式 INV-2（已通过 K2-CASCADE 变异实验确凿证明）。
- 验证：在一次性数据库及元数据核查中确认 `confdeltype = 'r'`，且外键违规 DML 均被数据库正确拒绝（SQLSTATE 23503）。

### 2. DEV-S3-02 复合外键已生成并核对，未走退路
- 决定：直接由 Drizzle ORM 生成复合外键 `foreignKey({ columns: [table.eventId, table.organizationId], foreignColumns: [events.id, events.organizationId] })`，落地于迁移 `0002_registrations.sql`。
- 依据：
  - Drizzle Kit 顺利生成了标准的 PostgreSQL 复合外键约束 `registrations_event_org_fk`；
  - 在数据库 `pg_constraint` catalog 中核验其跨列引用（引用列为 `events(id, organization_id)`）；
  - 未启用任何降级退路（如放弃数据库复合外键而退化为仅靠应用层查询过滤或触发器），实现了数据库级别的跨租户数据隔离防线。

### 3. DEV-S3-03 响应体不暴露 `seq` 与 `organizationId` 的理由
- 决定：`POST /api/orgs/:orgId/events/:eventId/registrations` 的成功响应体 DTO 严格仅暴露 `id`、`eventId`、`userId`、`status`、`createdAt`，不包含 `seq` 与 `organizationId`。
- 理由：
  - `seq`：属于内部自增序号（`GENERATED ALWAYS AS IDENTITY`），用于实现确定性 FIFO 候补队列排序，属于存储层实现细节，不属于外部消费者的业务凭证；
  - `organizationId`：已经在 RESTful URL 路径参数（`/api/orgs/:orgId/...`）中显式指定，且已通过组织鉴权中间件校验；在返回的报名实体中冗余返回组织 ID 既不符合精简契约原则，也增加了客户端不必要的依赖。

### 4. DEV-S3-04 C6 中 `clock_timestamp()` 与 `now()` 的区分验证延后到 D4
- 决定：在 S3 切片中，`register` 业务逻辑在取得行锁后严格使用独立语句 `SELECT clock_timestamp() AS current_time` 获取真实时间，并用于截止时间与开始时间的比较；但针对「在长时间事务等待中 `clock_timestamp()` 随物理时间推进而 `now()` 冻结于事务开始」的独立区分变异验证，延后至 D4 切片与取消/递补时间窗口统一验证。
- 依据：S3 当前聚焦于行锁互斥（C1/C2/C7）与并发名额判定，D4 涉及取消窗口及开始后状态流转，更适合集中构建跨秒事务休眠的真实时间对比测试。

### 5. DEV-S3-05 并发 CI Job 重复 5 次延后到 D4
- 决定：GitHub Actions CI 中的 `concurrency-tests` Job 当前执行 1 次完整并发测试套件（含 C1 50 并发、C2 10 并发、C7 锁等待与观测）；将其在 CI 中循环重复执行 5 次以检验绝对稳定性的策略延后至 D4 统一编排。
- 依据：控制 S3 CI 执行耗时与连接池开销，优先保证连接预算检查（>= 76）与核心并发契约在单次高强度运行下的确定性通过。

### 6. DEV-S3-06 BR-10 作者已决定保留（日期 2026-10-27）
- 决定：业务规则 BR-10（“活动开始后禁止取消报名”）经作者于 2026-10-27 明确决定保留。
- 依据与边界：PRD.md 文本的正式修订由作者另行批准，当前切片不修改 PRD.md。相关取消逻辑与测试在 D4 切片中严格遵循此规则进行实现与验收。

### 7. DEV-S3-07 S3 变异实验结果摘要
- **K2 数据库物理约束变异（全部通过）**：
  1. `status` 去掉 `NOT NULL` -> K2-1 变红（预期 23502 违规被放行，断言失败）；
  2. `registrations_status_check` 删除 -> K2-2 变红（非法状态值被放行，断言失败）；
  3. `registrations_event_user_active_uniq` 删除 -> K2-4、K2-5 均变红（重复 active 报名被放行，断言失败）；
  4. `registrations_event_org_fk` 复合外键删除 -> K2-3 变红（跨组织非法 event_id 与 org_id 组合被放行，断言失败）；
  5. `seq` 改为 `GENERATED BY DEFAULT` -> K2-7 变红（显式指定 seq 值被放行，断言失败）；
  6. `user_id` 外键改为 `ON DELETE CASCADE` -> 目标用户被删除后，容量 2 的活动确认数由 2 降为 1，但候补人员仍在，INV-2 被确凿破坏。
- **C7 锁互斥与依赖方向变异（全部通过）**：
  1. (a) 正常基线 -> C7 顺利变绿，观察者在 188ms 内捕获 B 被 A 阻塞；
  2. (b) 移除 `register` 中的 `.for("update")` -> C7 变红，B 无需等待直接提交，观察者超时 10s；
  3. (c) 保持 (b) 的删除，同时将 A 的 `FOR NO KEY UPDATE` 改为 `FOR UPDATE` -> C7 重新变绿（208ms），因 B 插入 registrations 时的外键检查触发 `FOR KEY SHARE`，与 A 的 `FOR UPDATE` 冲突被阻塞，证明了 C7 采用 `FOR NO KEY UPDATE` 检验业务显式锁的必要性；
  4. C7(c) 实验输出中，去掉 FOR UPDATE 后 C1 出现 "expected 47 to be 10"（确认数 47，超卖 37），C2 也失败，这是去掉行锁后并发超卖的直接观察。注明这是实验中的观察，已恢复，不进提交。
- **I3 跨组织隔离防御纵深变异（全部通过）**：
  1. M7a 观察到 HTTP 断言红（期望 404，实得 500）；数据库断言未执行；回滚由复合外键 23503 推断，未直接观察。
  2. M7b 观察到 HTTP 断言红（期望 404，实得 201）；数据库断言未执行；越权写入由 HTTP 201 推断，未直接查库。

### 8. DEV-S3-08 S3 未验证项清单
- **G2–G4 RPC 类型守卫负向实验**：沿用 D2/S2 登记，未在本次切片独立编写负向破坏测试，保留为证据缺口；
- **C6 `clock_timestamp()` 与 `now()` 独立区分测试**：延后至 D4；
- **CI 并发测试 5 次重复执行**：延后至 D4；
- **已知限制**：`.github/workflows/ci.yml` 的连接预算检查里，`SHOW reserved_connections` 失败时被 `catch {}` 静默当作 0。PG18 上该参数存在，目前无害；后续可收窄为只忽略 SQLSTATE 42704。

### 9. DEV-S3-09 开发环境 Docker 容器拓扑冲突排查与定界
- 开发环境存在两套 Docker（Windows Docker Desktop 与 WSL2 内独立 Docker），各有同名容器 `event-system-postgres-1` 与同名卷。Docker Desktop 的容器 `bf12e07b38dd` 持有 `127.0.0.1:5433`，当时 7 表 1 条迁移记录；WSL 的容器 `a4492f4a93f5` 有 8 表 2 条迁移记录。
- 结论：以 Docker Desktop 那套为唯一开发库；WSL 那套已 stop（未 rm，卷保留）。此前"把临时库误认作开发库"的解释作废。

## 2026-10-30 D4（S4）取消、候补递补与名额调整架构决策、变异实验与落地记录（DEV-S4-01 至 DEV-S4-07）

### 1. DEV-S4-01 DEV-S3-06 历史记录更正澄清

- **更正内容**：在 S3 决策记录 `DEV-S3-06` 中，标题与正文将业务规则编号误记为 BR-10（原表述为“业务规则 BR-10（‘活动开始后禁止取消报名’）经作者于 2026-10-27 明确决定保留”）。
- **事实澄清**：
  - “活动开始后禁止取消报名”实际对应的业务规则是 **BR-6**；
  - **BR-10** 的实际定义是 owner/admin 取消活动（“owner/admin 可把活动置为 `cancelled`”）；
  - 特此追加记录予以纠正，原 `DEV-S3-06` 历史条目保持现状不修改。

### 2. DEV-S4-02 D4 六项架构与契约决策批准记录

- **决定**：作者在 D4 计划中明确批准了以下六项关键契约与边界决策：
  1. **决策 1（BR-10 保留）**：保留取消活动业务功能（`POST /api/orgs/:orgId/events/:eventId/cancel`），不执行裁剪；
  2. **决策 2（PATCH 字段校验白名单与不可变字段）**：`PATCH /api/orgs/:orgId/events/:eventId` 请求体只接受 `title`、`description`、`capacity` 三个字段中的至少一项，请求体使用 `.strict()` 拒绝任何未知字段；活动开始时间（`startsAt`）与报名截止时间（`registrationDeadline`）严格不可修改；
  3. **决策 3（名额变更识别与活动开始后边界）**：请求体只要显式包含 `capacity` 键即视为改名额操作（不与现有值比对）；若活动已开始，包含 `capacity` 的修改一律拒绝并返回 409 `EVENT_STARTED`；活动开始后仅修改 `title` 或 `description` 允许通过（返回 200）；`description` 传入 `null` 表示清空，字段缺省表示保持原值不变；
  4. **决策 4（PATCH 与 cancel 响应 DTO 复用）**：PATCH 与 cancel 成功响应（200）完整复用创建活动的响应 DTO（`eventResponseSchema`，返回活动全量实体），不包含 `confirmedCount` 与 `waitlistedCount` 计数；
  5. **决策 5（参数校验先于业务及统一错误格式）**：组织权限中间件先于路径参数校验执行（非组织成员访问返回 403 `FORBIDDEN`，组织成员访问非法 UUID 路径参数返回 400 `VALIDATION`）；所有参数错误均走统一错误体 `{ "error": { "code": "VALIDATION", "message": "..." } }`，杜绝穿透抛出数据库 `22P02` 异常；
  6. **决策 6（I7 额外 owner 移除用例延期）**：PRD I7 中关于在多 owner 组织中移除其中一个 owner 的额外补充用例延期执行，本切片不做，在验收记录中如实标为延期未测试，不计入通过项。

### 3. DEV-S4-03 新增决策：活动开始后禁止取消活动

- **决定**：在 PRD.md §3 BR-10 规则及 §6 业务流程中明确追加规则——“活动开始后不可取消活动”。
- **理由**：活动一旦开始，现场已进入签到与进行阶段，若允许组织管理者取消活动，将导致已到场人员状态处于未定义状态；若活动已开始（`dbNow >= starts_at`），调用 `POST /api/orgs/:orgId/events/:eventId/cancel` 抛出 `EVENT_STARTED` 领域错误，由 HTTP 层映射为 409 `EVENT_STARTED`。

### 4. DEV-S4-04 并发测试重复运行机制（repeat.mjs）与本地/CI 执行方案

- **决定**：
  - 新增原生 Node.js 执行脚本 `scripts/repeat.mjs`，不引入第三方依赖，采用 `spawnSync` 顺序执行子命令，任何一次迭代失败立即终止，输出失败迭代序号、执行命令与子进程退出码；
  - **运行方案**：
    - 本地门禁：`pnpm gate` 内运行单次完整并发测试套件（`pnpm test:concurrency`）；本地高强度验证执行 20 次重复（`node scripts/repeat.mjs 20 -- pnpm test:concurrency`）；
    - CI 门禁：`.github/workflows/ci.yml` 中的 `concurrency-tests` Job 采用 `node scripts/repeat.mjs 5 -- pnpm test:concurrency` 连续重复执行 5 次，确保在受限容器环境下无并发时序闪烁。

### 5. DEV-S4-05 M1–M6 变异实验结果记录

- **M1（删除 lockEventAndReadClock 中的 .for("update") 行锁）**：
  - 结果：**变红**。C7 锁互斥测试失败（观察者因 B 无需等待直接提交而超时）；
  - **关键实验观察数字（README 素材）**：在移除活动行锁的情况下执行 C1（50 并发抢 10 个名额），最终确认报名数由预期的 10 人激增至 47 人（超卖 37 人），INV-1 核心不变式被确凿破坏；C4 并发取消与报名同样发生严重状态错乱。变异代码已完全恢复。
- **M2（将独立时钟读取 clock_timestamp() 替换为事务启动时间 now()）**：
  - 结果：**变红**。C6 等锁交错用例（Part 5: deterministic lock interleaving）失败：事务 B 在等待 A 释放活动行锁期间，A 将截止时间推进到当前物理时间；B 获锁后若使用 `now()`，读到的仍是事务 B 启动时的旧时间戳（早于截止时间），错误放行了逾期报名（返回 201 而非 409 `REGISTRATION_CLOSED`）；
  - **核验补充说明**：变异执行前已通过 `waitForLockWait` 严格确认事务 B 在 `pg_stat_activity` / `pg_locks` 中真实处于等待 PID A 的锁阻塞状态；其余静态 C6 用例（如设置历史 10 分钟或 1 小时）因事务启动时间与物理时间均已过截止期，未受 `now()` 影响保持绿灯，证实必须依赖行锁等待交错实验方能区分 `clock_timestamp()` 与 `now()`。变异代码已完全恢复。
- **M3（将候补递补排序 seq ASC 改为 seq DESC）**：
  - 结果：**变红**。C3 用例失败：取消确认报名后，系统递补了候补队列中最晚加入（seq 最大）的用户，违反 FIFO 不变式 INV-3；C5 名额调大递补测试同样变红。变异代码已完全恢复。
- **M4a（取消报名按 id 过滤时去掉 event_id 条件）**：
  - 结果：**变红**。C8 与 A1 失败：使用同组织内错误活动 ID 与目标报名 ID 发起取消时，未能返回 404 `NOT_FOUND`，破坏了活动边界防护。变异代码已完全恢复。
- **M4b（取消报名按 id 过滤时去掉 organization_id 条件）**：
  - 结果：**行为测试未捕获**。
  - **原因分析**：由于前置查询中已有 `event_id` 过滤，且数据库物理 schema 存在 `(event_id, organization_id)` 复合外键强制约束，一个特定 `event_id` 在物理上不可能跨组织存在；因此在现有行为测试用例下未表现为失败。如实记录为“行为测试未捕获”。
  - **防御证明（grep 证据）**：通过源码静态审查与严格 grep 核验，确认 `apps/api/src/registrations.ts` 与 `apps/api/src/event-tx.ts` 中涉及 `registrations` 的全部 7 处查询、插入与更新操作均显式包含 `organization_id` 与 `event_id` 双重过滤。变异代码已完全恢复。
- **M5（将时间检查 assertNotStarted 置于状态检查 assertNotCancelled 之前）**：
  - 结果：**变红**。C6 优先级用例失败：对于既处于 `cancelled` 状态又已过 `starts_at` 的活动，系统错误返回了 409 `EVENT_STARTED`，而非 PRD 规定的更高优先级的 409 `EVENT_CANCELLED`。变异代码已完全恢复。
- **M6（删除取消报名中“已是 cancelled 则提前 noop”的短路分支）**：
  - 结果：**变红**。C8 与 A1 重复取消断言失败：对已取消的报名记录再次执行取消时，若未提前 noop，会导致 UPDATE 再次执行并刷新 `cancelled_at` 时间戳，导致取消前后的全列比对失败。变异代码已完全恢复。

### 6. DEV-S4-06 审查确认的未验证项与证据缺口

- **G2–G4 类型守卫负向实验（未验证 / UNVERIFIED，证据缺口保留）**：
  - `apps/web/src/types/api-client-guard.ts` 中当前已包含针对 PATCH 与 DELETE 等路由的正向类型守卫断言（`NotAny`、`Equal` 等）；
  - G2（`AppType` 故意退化为 `any`/`unknown`/`{}`）、G3（故意写错路径参数键触发类型报错）、G4（仅由 CI 中 `next build` 捕获的专属红对照）仍未进行独立负向破坏性验证，继续作为证据缺口记录；
  - 澄清：G2–G4 属于前端客户端类型的负向控制实验，非部署、非压测。

### 7. DEV-S4-07 S3 遗留问题核验结果（不记录缺陷）

- **核验结论**：P0 侦察与 A1 集成测试确凿证实，`POST /api/orgs/:orgId/events/:eventId/registrations` 路由在收到格式非法的 `eventId` 时，由 Zod OpenAPI 的 `defaultHook` 在应用层直接捕获，返回标准 HTTP 400 `{ error: { code: "VALIDATION", message: "..." } }`，不会穿透至 PostgreSQL 引发 `22P02 invalid input syntax for type uuid` 的 500 异常；因此不记录 S3 遗留问题。
