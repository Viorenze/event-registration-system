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
