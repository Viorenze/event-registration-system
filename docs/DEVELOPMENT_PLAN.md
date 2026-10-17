# 个人项目 AI 开发顺序（活动报名系统）

Oct 12, 2026 · @Ani

## 10 月 17 日再修订（第五轮评审）

这一轮的意见是「四项局部修订后冻结」。逐条核对：前三项成立；第四项的方向成立，但建议的写法有漏洞，收窄后采纳。

| 项 | 我的判断 | 改在哪 |
| --- | --- | --- |
| AGENTS 规则 3 与 `/api/auth/*` 例外冲突 | 采纳。规则 3 写「每个接口先过权限中间件」，而 Better Auth 的 `/api/auth/*` 不套用我们的中间件；PRD 第 4 节同一句也没限定范围。改成「自建业务接口」，写明例外和 I6、I7。没有用对方给的整段替换：它会丢掉「业务表都带 organization_id」和「只有显式豁免清单里的路由可以不在路由表里」两句，也把「我」改成了「作者」 | AGENTS 规则 3（文件与本文件嵌入块同步）；PRD 第 4 节规则 |
| 邀请回退与 D2 验收冲突 | 采纳。回退时 I6 作废，D2 却要求「I6 通过」。验收按所走路径分开写；同样的无条件引用（D6、Sonnet review 范围、PRD S1、S6）一并补条件，不留互相冲突的说法 | 本文件 D2、D6、review 范围；PRD 第 8 节 I6 说明、第 10 节 S1、S6 |
| I7 缺「owner 移除成员」对照组 | 采纳。移除和改角色各用独立的目标成员，每种操作先测被拒绝、再测 owner 成功；否则对照组先把目标移除了，后面的拒绝可能只是「目标不存在」 | PRD I7 (c) |
| 去掉 `FOR UPDATE` 后的预期不一致 | 部分采纳。「C1、C4、C7 必须变红」与诊断步骤「仍然全绿先查原因」确实矛盾，改成 C7 必须变红、C1、C4 只作补充。但对方说 C7 是 `FOR UPDATE` 是否生效的确定性证据，这在 C7 没规定持锁模式时不成立：A 若用 `FOR UPDATE` 持锁，外键检查的 `FOR KEY SHARE` 会被 A 挡住，业务代码删掉 `FOR UPDATE` 后 B 照样等锁，C7 仍然绿。所以 C7 同时规定 A 用 `FOR NO KEY UPDATE`。这一条改动了锁定的第 8 节 C7 | PRD 第 8 节 C7 与说明、证明范围、诊断步骤；本文件防翻车规则第 1 条、并发测试注意点、未核实事项 |

## 10 月 17 日修订（第四轮评审）

这一轮评审的结论是「局部修订后即可冻结」。逐条核对后，成立的采纳，没有重开方案。

| 项 | 我的判断 | 改在哪 |
| --- | --- | --- |
| Better Auth 团队管理接口 | 采纳，范围收窄。`/api/auth/*` 被豁免后，创建团队、删除团队、移除成员、修改角色这些内置接口没有权限契约，用户可以绕过页面直接调用。只禁用产品用不到、风险最大的删除团队，其余保持 Better Auth 默认权限，用新增的 I7 验证默认权限确实生效；不另起一套认证 | PRD 第 4 节末尾、I7；D2 验收；Sonnet review 范围 |
| 状态列只写了取值，没有约束 | 采纳。`status` 加非空和 CHECK。评审没有要求测试，我加了 K1、K2 直接对数据库写违规数据，否则这些约束没有「先看测试失败」的办法 | PRD 第 5、8 节；S2、S3 验收 |
| C4 的「始终成立」 | 采纳，选「只声称最终状态」：改措辞并写明证明范围；不加每次提交前的检查（那需要在业务层开测试钩子，超出本周预算）。「任何时刻成立」留作设计要求，由行锁串行化和诊断步骤支撑 | PRD INV 说明、C4、证明范围一段 |
| 连接预算的通过条件 | 采纳。可用数 ≥ 76 才算通过，不够不能只记录 | PRD 第 8、9 节 |
| 邀请接受流程没有测试 | 采纳，并入 I6：邮箱不匹配被拒绝、匹配成功；顺序固定，先测被拒绝的 | PRD I6 |
| C7 只写了 `lock_timeout` | 采纳。等待的证据改为 `wait_event_type = 'Lock'`，`lock_timeout` 只防挂起 | PRD C7；并发测试注意点 |
| 条件功能的裁剪规则 | 采纳，写成同步清单。BR-10 默认保留，最晚在 D4 的 review 前决定 | PRD 第 7、12 节 |
| 报名成功码留给 D3 | 采纳，我先定：首次 201，重复报名 200，响应体带报名 id 和状态。你有异议就改 | PRD 第 7 节、A1 |
| 备选方案绕过依赖审批 | 采纳。备选需要的依赖在计划里提前列出，随计划审批 | PRD 第 9 节 |
| 其余方案不需要重开 | 同意。公网部署、工具链备选、展示细节不再继续拖延 D1 | — |

## 10 月 13 日修订：收紧契约，部署降级

这一轮的意见来自对 PRD.md 和 AGENTS.md 的审查。逐条核对后，成立的采纳；已经满足的和被误读的没有改。

| 项 | 我的判断 | 改在哪 |
| --- | --- | --- |
| 业务时间判断 | 采纳。PostgreSQL 官方文档：`now()` 等价于 `transaction_timestamp()`（事务开始时间），`clock_timestamp()` 返回实际当前时间。事务在行锁上等待之后，用 `now()` 会放过超时报名。改成取得活动行锁后，用一条独立的语句读 `clock_timestamp()`，并加等锁交错测试 | PRD BR-4、第 6 节、C6；AGENTS 规则 4 |
| 报名幂等与截止的顺序 | 采纳。顺序：锁活动 → 已取消或已开始则 409 → 已有有效报名则回显 → 判断截止 → 插入 | PRD BR-6、BR-9、第 6 节、C6 |
| `DELETE …/me` | 采纳。没有有效报名返回 204，但先过活动状态检查；管理员取消时按 registrationId + eventId + organizationId 查找 | PRD 第 6、7 节、C8 |
| C1 的候补顺序断言 | 采纳。请求被处理的顺序无法观测，换成可验证的结构断言 | PRD C1 |
| I5 路由完整性 | 采纳。显式豁免清单，新增豁免要你批准 | PRD I5 |
| 并发测试的连接 | 采纳。并发测试直接调用业务层，写明连接预算 | PRD 第 8 节 |
| 指令模板没读 PRD | 当前文件已经满足，不创建 `docs/intent.md`；模板与 slice 技能统一读 PRD.md、AGENTS.md、docs/DECISIONS.md | 指令模板、slice 技能 |
| 验收命令没覆盖 `next build` | 采纳。D1 创建 `pnpm gate` 作为统一入口 | 指令模板、AGENTS、CI 门禁 |
| D1 时间预算 | 采纳。上午、下午各 4 小时，每项最多 2 小时；没有备选的基础项不得因超时放行 | PRD 第 9 节 |
| 部署 | 采纳。公网部署降为可选加分项，不阻塞 D1，不进 D2、D6 的验收 | 「交付标准与部署」、七天计划、PRD 第 10、12 节 |
| Sonnet 额度 | 采纳。全周只安排一次有明确范围的 review | 「模型分工」、七天计划 |
| 测试层边界（第二轮审查） | 采纳。C 系列直调业务层，只断言领域错误和数据库状态；HTTP 状态码映射由新增的 A1 单独测。`register` 里的「返回」写明是从事务回调返回、由事务提交 | PRD 第 6、8 节 |
| 邀请接口权限（第二轮） | 采纳。`/api/auth/*` 被豁免后，权限矩阵里「邀请成员」一行没有测试覆盖；新增 I6，带 admin 和 owner 的对照组 | PRD I6；D2 验收；Sonnet review 范围 |
| 创建活动的时间校验（第二轮） | 采纳。创建时没有活动行可锁，是「先锁后读」的唯一例外：在事务里单独读 `clock_timestamp()` 校验 `starts_at` | PRD BR-3、第 6 节；AGENTS 规则 4 |
| D1 上午的迁移验收（第二轮） | 采纳。上午只验证 Postgres 能起、Drizzle Kit 配置正确并能连库；真正的空库迁移放到下午认证 schema 生成之后 | PRD 第 9 节；D1 计划 |
| 门禁前置命令（第二轮） | 采纳。`pnpm gate` 创建之前也要带 `next build` | AGENTS、指令模板、slice 技能、CI 门禁 |
| 切片循环图（第二轮） | 采纳。图在本文件里只是占位，改成文字版，避免留下互相冲突的升级规则 | 「每个切片的工作循环」 |

## 10 月 12 日修订：采纳了什么

ChatGPT 这轮的意见我都采纳了，但有两处改了做法：锁测试只当诊断，不当硬门槛；团队加入受 Better Auth 邀请机制限制，不能做成不绑邮箱的链接。

| 意见 | 我的判断 | 改在哪 |
| --- | --- | --- |
| D1 太挤 | 采纳。同样六项验证按风险拆成上午（工具链）和下午（认证与契约）；浏览器登录挪到 D2 | 开发顺序总览、七天计划 |
| CI 别在 D1 就上全套 | 采纳。分成开发门禁和合并门禁，按天加检查 | CI 门禁 |
| 拿掉锁变红不是绝对保证 | 采纳。改成诊断步骤，以数据库最终状态为准，另加一个确定性的交错测试 | 防翻车规则、并发测试注意点 |
| 团队成员怎么加入 | 部分采纳。官方文档写明邀请必须填被邀请人邮箱，接受时登录邮箱要与之匹配，所以做成「按邮箱邀请 + 复制链接」，不发邮件；超时退回管理员直接添加 | 已定决策、PRD.md |
| 四条业务规则 | 采纳，并补两条：名额调大时的递补、重复报名与重新报名 | 业务规则、PRD.md |

## 你整理的顺序有没有用

有用，大部分可以直接用，但要改三处才适合这个项目。它的主线「目标 → 骨架与验证 → 契约 → 垂直切片 → 持续验证 → 发布」，和这个项目的难点（认证、组织隔离、并发正确性）是对得上的。

| 你的原则 | 在本项目里怎么用 | 是否要改 |
| --- | --- | --- |
| 目标先于实现 | `PRD.md`：用户流程、不做什么、业务规则、两个硬证据 | 直接用 |
| 验证先于规模化 | D1 就接上 CI 门禁，并发测试在 D3 写出第一版 | 直接用，并提前 |
| 契约先于实现 | Drizzle schema、Zod 与 OpenAPI、权限规则先定，再让 AI 写实现 | 直接用，最关键 |
| 垂直切片 | 每次打通「一条流程」：登录 → 建活动 → 报名 → 取消递补 | 直接用 |
| Evals 与评估集 | 本项目没有 LLM 功能，改成验收测试：并发不超卖、组织隔离、Playwright 主流程 | **要改** |
| 简单方案优先、逐步加复杂度 | 对应「栈不再扩张、卡住就用备选方案」 | 直接用 |
| 人把关关键判断 | 认证、权限、迁移、事务四处必须自己读懂 | 直接用，并列出清单 |

## 要改的三处

1. **把 Evals 换成验收测试。** 你的顺序里评估针对提示词、检索和 Agent。这个项目的「评估」是能重复运行的测试：50 个并发请求争 10 个名额，断言 10 人确认、40 人候补、零超卖；A 组织的用户碰不到 B 组织的数据。
2. **在「探索」前加一个技术验证（Spike）。** 栈里有几处没有现成保证：Hono RPC 与 OpenAPI 的组合、Better Auth 经代理后的 Cookie、`vp check` 对 Next.js 的支持。先用 D1 的六项清单实测，再规划，别让 AI 在没验证的假设上写一整天代码。
3. **部署不要压在最后一天，也不要放进关键路径。** 认证 Cookie 在线上域名下的行为和本地不同，原本建议 D2 就部署一个空骨架。但你没有找到免费、大陆可访问、手续简单的方案（见「交付标准与部署」），所以公网部署降为可选加分项，本周以 Docker Compose 本地复现、CI 记录和演示录屏为交付标准。这是我的判断，不是你的原文。

## 和 EvidenceOS 的做法有什么不同

EvidenceOS 的 PRD 一开始就把范围、接口、数据模型全部写死，因为一周内要做完一个完整系统。这个项目只在安全和正确性相关的部分提前定契约（数据库约束、事务规则、权限），其余部分用薄计划、一个切片一个切片地推进。

## 项目约束与已定决策

这是一周、一个人、TypeScript 全栈的项目，要用可重复运行的测试证明两件事：并发下不超卖，组织之间数据隔离。开工前提：EvidenceOS 已在干净克隆上跑通 `docker compose up` 和三分钟演示（你已确认完成）。

| 决策 | 已定做法 | 备选（卡住超过 2 小时才用） |
| --- | --- | --- |
| 认证放哪 | Better Auth 挂在 Hono，Next.js 只做界面 | — |
| 浏览器如何访问认证 | 先试 Next.js 同源代理 `/api/*` 到 Hono | 浏览器直接跨域请求，配 CORS、credentials、`trustedOrigins` |
| Next.js 调 Hono | Hono RPC 为主，OpenAPI 只出 `/doc` 文档 | `openapi-typescript` 生成类型 |
| 表结构和迁移 | Better Auth CLI 生成认证表 → 放进 Drizzle schema → **只用 Drizzle Kit 迁移** | — |
| 租户模型 | 一个团队 = 一个 Organization，不开内部 Teams，用 owner/admin/member | — |
| 团队加入 | 管理员按邮箱邀请，界面上复制邀请链接，不发邮件；受邀人用同一邮箱登录后接受 | 管理员按邮箱直接添加已注册用户（服务端 addMember，自写接口检查权限） |
| 不超卖 | 事务里先 `SELECT ... FOR UPDATE` 锁活动行，再检查名额；取得锁之后单独读取数据库的 `clock_timestamp()` 判断业务时间（不用 `now()`）；“活动 + 用户”部分唯一索引做最后防线 | 条件更新、原子计数（有需要再说） |
| 工具链 | Vite+ 1.0 管 `vp check`、`vp test`；Next.js 仍用 `next build` | 独立 Vitest + Oxlint + `tsc --noEmit` |

## 交付标准与部署

公网部署不是本周的验收条件。你希望尽量免费、同时让中国大陆能访问，但没有找到能可靠满足全部条件的方案，所以它不阻塞 D1，也不进 D2、D6 的验收。

**本周必须交付：**

- 公开的项目代码仓库（新仓库；首次推送前检查密钥、真实数据和环境配置文件，清单见 PRD.md 第 11 节）。
- Docker Compose 本地启动和复现说明。
- 真实 PostgreSQL 的并发与组织隔离测试，以及 CI 运行记录。
- README、架构图、已知限制、完整的演示录屏。录屏展示核心流程，并附可核对的测试结果；视频不能代替自动化测试。

**可选加分项：公网部署。** 只有找到成本可接受、条款合适、并且实际从中国大陆测试过可访问的方案才尝试；找不到就按上面的标准交付，不因此推迟项目。

**为什么这样定**（来自官方资料；这些资料不能推出“所有境外托管都必须办 ICP”）：

- Vercel 官方说明：它在中国大陆没有服务器和 CDN 节点，Vercel 托管的站点在大陆可能很慢或打不开，它不保证大陆的可用性和性能。它的对比表把自定义域名、静态镜像等境外做法标为不需要 ICP，把大陆境内部署标为需要 ICP。
- 工信部《非经营性互联网信息服务备案管理办法》第二条、第五条：在中华人民共和国境内提供非经营性互联网信息服务，应当履行备案手续。它是否适用于某个具体的境外托管作品站，我没有法律结论。
- Cloudflare China Network 的官方准入要求：Enterprise 套餐加购 China Network，域名要有 ICP，并经合作方 JD Cloud 审核内容。
- 所以三种情况限制不同：境外托管，访问质量没有保证；境内托管，需要 ICP；境内网络加速，需要 ICP 加内容审核。免费、稳定供大陆访问、手续简单这三点同时满足的方案，你没有找到。

**没有做公网部署的代价**：Secure Cookie 和 HTTPS 下 `trustedOrigins` 在真实域名上的行为不会被验证。README 的已知限制里如实写，不要写成“已部署验证”。

## 两个硬证据（验收标准）

1. **并发**：50 个不同用户并发抢 10 个名额→ 10 人确认、40 人候补、确认人数超过名额为 0、重复报名为 0。还要测取消递补、重复点击、截止后报名。必须连真实 PostgreSQL，不能用 Mock。
2. **隔离**：A 组织的用户读取、修改、报名 B 组织的活动，必须被拒绝。Better Auth 的角色不会自动保护你自己写的活动和报名接口，每个接口都要自己检查。

## 业务规则（我替你定的默认值）

这些是业务契约，不是新功能；不同意就直接改，改完同步到 PRD.md。

| 问题 | 默认规则 |
| --- | --- |
| 谁能管活动 | owner、admin 可创建、修改、取消活动并管理成员；member 只能看本组织的活动，报名和取消自己的报名 |
| 截止后 | 截止时间后拒绝新报名，但用户已有有效报名时，重复报名仍返回已有报名；取消仍然允许，取消后照常递补；活动开始后所有变更都拒绝 |
| 递补顺序 | 严格按候补记录的自增序号从小到大，在取消的同一个事务里完成，不跳人 |
| 改名额 | 调大：同一事务里按顺序递补新空出的位置。调小：不得低于已确认人数，否则拒绝 |
| 重复与重报 | 同一活动同一用户同一时间只能有一条有效报名（部分唯一索引）；取消后可重新报名，排到队尾 |
| 取消报名 | 当前用户没有有效报名时，`DELETE …/me` 返回 204 且不改库（先过活动状态检查）；管理员取消他人报名按 registrationId + eventId + organizationId 查找 |

## CI 门禁：开发门禁与合并门禁，按天加

本地统一入口是 `pnpm gate`：D1 定好包结构后创建，从 `vp check`、`vp test`、`next build` 起，每个切片提交前跑，之后随下表逐天加入迁移、真实 PostgreSQL 测试等（含当前切片的集成测试）。创建之前先用 `vp check`、`vp test`，以及 Next.js 工程建好之后的 `next build`。合并门禁是 PR 上的必需检查，不在 D1 一次上全，按下表逐天加。只在 CI 里跑的检查（如重复 5 次的并发 job、`docker build`），在 CI 配置和报告里如实标明，不能说 `pnpm gate` 已经运行了它。

| 从哪天起 | 新增的必需检查 | 备注 |
| --- | --- | --- |
| D1 | `vp check`、`vp test`、`next build` | 骨架阶段测试很少，也不许建空测试凑数 |
| D2 | 空库从头迁移、`docker build`、隔离测试 | 随组织权限一起加 |
| D3–D4 | 并发测试（单独一个 job，真实 Postgres，重复运行） | CI 里建议重复 5 次，D4 验收时本地连续 20 次 |
| D6 | Playwright 2–3 条主流程 | 页面做完才有可测的东西 |

两条规则：每加一个检查，先故意弄坏一次，确认它会变红再合并；`main` 的分支保护从 D2 起对已有检查生效，之后每加一个检查就加进必需列表，D6 前补齐。分支保护在公开仓库的 GitHub Free 下可用（GitHub 官方文档已核实）。注意：默认情况下分支保护对仓库管理员不生效，你作为仓库所有者要勾上“Do not allow bypassing the above settings”，否则保护对你自己是空的。

## 工具与模型分工

Flash 写实现和测试，Sonnet 5.5 全周只出场一次：D4 核心实现完成后、D5 前端开始前，做一次范围明确的审查。你的 Antigravity 套餐能用 Sonnet 5.5，但额度有限，一次整体 review 基本就用完。Antigravity 的功能、规则和额度我打开了官方文档核对；Gemini 的基准数字来自两篇转述 Google 发布表格的文章，不是 Google 原页面；属于我判断的已单独标明。

## 模型分工

| 任务 | 模型 | 原因 |
| --- | --- | --- |
| 实现一个切片（接口、业务逻辑、页面、表单）、写测试、Playwright 脚本、CI 配置 | Flash | 边界清楚、有明确终点的任务 |
| 修类型错误、格式、简单 bug、README | Flash | 便宜、迭代快 |
| 表结构、事务与锁、权限中间件的设计与代码 | Flash 实现，你自己读懂 | 涉及这些的切片都在计划阶段停下来由你审阅（AGENTS.md 规则 7）；Sonnet 额度不够逐个切片复核 |
| **唯一一次 Sonnet review：D4 核心实现完成后、D5 前端开始前** | Sonnet 5.5 | 范围见下 |
| Flash 连续两次修不好同一个问题 | 停下并报告；是否动用那一次 Sonnet 由你决定 | 额度只够一次，不自动消耗 |

### 那一次 Sonnet review 的范围

只要求报告影响安全性、正确性或交付的实质问题，不做风格性重构。检查：

1. Drizzle schema、唯一约束、CHECK 约束（K1、K2）与迁移流程。
2. Better Auth、组织成员关系、角色权限与跨组织隔离。
3. 报名、取消、递补、名额调整的事务和锁顺序（含 `clock_timestamp()` 的用法）。
4. C1–C8 并发测试是否真的能发现错误（会不会假绿）。
5. I1–I7 隔离测试（含 Better Auth 邀请接口的 I6 和团队管理接口的 I7；走 BR-2 回退时 I6 不适用，改查直接添加成员接口在路由表里的覆盖）有没有覆盖遗漏或假绿。

交给它的材料：schema 和迁移文件、权限中间件、事务代码、并发与隔离测试，以及 PRD.md 第 3–8 节。

已知取舍：schema 和锁方案在 D3 写出后，要到 D4 末才有外部审查。这期间靠你自己读、C7 交错测试和两个诊断步骤（拿掉 `FOR UPDATE`、把 `clock_timestamp()` 换成 `now()`）把关。

## 为什么这样分

- **Flash 适合有终点的活**。按 Google 发布的基准表（我读的是转述它的两篇文章），Gemini 3.8 Flash 在 DeepSWE v1.1 上得 73.7%（Claude Opus 5 是 74.0%），在 Terminal-bench 2.1 上得 89.4%。但在需要自己决定下一步的开放式任务上差距很大：Terminal-bench 4.0 上是 19.1%，Opus 5 是 51.8%。这些数字是 Google 自己跑的，我查到时还没有独立复现，跨厂商的对比只能当方向参考。
- 所以给 Flash 的指令要小、要有终点：指定文件、指定验收命令、写明不要改什么。这个建议来自上面的基准结果和我的判断。
- 据转述的 Google 说法，该模型会“更努力”，用更多推理和工具调用，耗的 token 更多。额度要留着，不要让它无终点地“自由发挥”。
- Sonnet 5.5 在 Antigravity 里不能用于免费版，仅限付费套餐（Google AI Pro 非试用期、Ultra、Enterprise）；官方把 Gemini 和 Claude/GPT 分成两个独立的额度桶，各有每周与每 5 小时的限制，用百分比显示剩余，没有公布具体数值。你的套餐能用 Sonnet 5.5，但实际额度很有限，一次整体 review 就基本用完，所以全周只安排一次。每天开工前先看一眼剩余百分比。
- 切换模型时，如果 Agent 正在运行，它会用原模型跑完当前这一轮，除非你取消。

## Antigravity 怎么配

1. **规则文件**。仓库根目录的 `AGENTS.md` 始终生效，不需要头部配置。其他规则放在 `.agents/rules/*.md`，**每个文件必须在头部写 `trigger`**（`always_on`、`model_decision`、`glob`、`manual`），写错（比如写成 `alwaysOn`）或缺失会被静默丢弃，不报错。单个文件超过 24,000 字节会被截断；全局规则和 always\_on 规则共用 20,000 token 的预算。所以 `AGENTS.md` 保持很短，细节拆成按文件路径触发的规则（例如数据库规则只在处理 `db/`、`drizzle/` 时加载）。
2. **技能（Skills）**。放在 `.agents/skills/<名字>/SKILL.md`，头部必须有 `description`。Antigravity 2.0 里可以输入 `/<技能名>` 手动触发；IDE 里是否支持这种触发，官方页面没写，D1 自己试一下。建议只做两个：`slice`（开始一个切片的固定步骤）和 `verify`（跑全部门禁并报告）。
3. **实现计划产物（Implementation plan）**。用 `/plan` 可以随时生成；除非你把审阅策略设成“总是继续”，它会先让你审阅、评论，再点 Proceed。所以不要把策略设成“总是继续”，尤其是涉及表结构、认证、事务的切片。
4. **权限**。默认 Agent 只读写项目文件夹，沙箱外的终端命令会先询问。用默认预设，不要开“Unrestricted”。
5. **Git**。支持 Git worktree，并有版本控制面板可以按文件查看 Agent 的改动并单独暂存或丢弃。每个切片一个分支、一次提交，提交前自己看 diff。
6. **浏览器**。`/browser` 可以连 Chrome DevTools，并把操作录成 WebM，适合录演示和手工看一眼登录流程。但门禁仍然是 Playwright，不要用浏览器录像代替测试。

## 开发顺序总览

顺序是：意图 → 骨架与门禁 → 技术验证 → 契约 → 垂直切片循环 → 持续验证 → 发布。每一步都有一个能检查的产物，不过关不进入下一步。

1. **意图与验收（开工前 30 分钟）**。产物是 `PRD.md`：用户流程、不做清单、业务规则、权限矩阵、两个硬证据。把关：你。
2. **骨架与基础门禁（D1 上午）**。脚手架、Postgres 的 Compose、Drizzle Kit 配置并连上库、基础 CI（`vp check`、`vp test`、`next build`）、本地统一入口 `pnpm gate`。验收：PR 上 CI 全绿。把关：你。
3. **技术验证（D1 下午，总预算 4 小时）**。三项高风险：Better Auth + Hono 的 API 级登录链路（含 Next.js 代理下的 Cookie）、认证表进 Drizzle 迁移、RPC + OpenAPI 最小链路；上午的工具链、CI、Compose 算另外三项，共六项；上午、下午的总预算各 4 小时，每项最多 2 小时。有备选的项超时就用备选并记录；基础 CI、Postgres 与 Drizzle Kit 连库、认证表进 Drizzle 迁移（含空库迁移）没有备选，不能因超时放行，没通过就如实报告阻塞。产物：`docs/DECISIONS.md` 记录每项的结论。把关：你。
4. **契约（D2–D3）**。定下 Drizzle schema（含认证表和唯一约束）、权限矩阵（谁能对活动和报名做什么）、路由的 Zod 签名、并发不变量。把关：你自己读懂；D4 之后统一做一次 Sonnet 5.5 review。
5. **垂直切片循环（D2–D6）**。五个切片：登录与组织（含邀请成员）、创建与列出活动、报名与候补、取消与递补、页面与管理。每个切片的步骤见下一节。
6. **持续验证（贯穿始终）**。每个切片结束跑 `pnpm gate`；事务、权限、迁移相关的切片在计划阶段停下来由你审阅，D4 之后做唯一一次 Sonnet 5.5 review。
7. **发布与复盘（D6–D7）**。环境变量、日志、错误监控、README、架构图、演示录屏、已知限制。验收：空库从头迁移后，全部门禁仍然全绿。公网部署是可选加分项，不在验收里。

与你原来的六阶段相比，这里多了第 3 步（技术验证）；部署原本提前到 D2，现在改为可选加分项。

## 每个切片的工作循环

每个切片按同一个循环做：先写会失败的测试，门禁全绿并且你看过 diff 才提交。

1. Flash 读 PRD.md（唯一事实来源）、AGENTS.md、docs/DECISIONS.md，写计划。涉及表结构、认证、事务、迁移时停下，等你审阅。
2. 先写会失败的测试，确认它因功能缺失而失败。
3. 写让测试通过的最小实现。
4. 跑 `pnpm gate`。
5. 没过：让 Flash 修，最多 2 次。还不过，就停下，把报错和相关文件报告给你，由你决定是否动用那一次 Sonnet review，不自动升级。
6. 通过：你看 diff（包括 `package.json`，以及测试文件有没有被削弱），再提交。
7. 进入下一个切片。

### 给 Flash 的指令模板

每次都用同样的结构，指令越具体，Flash 越不容易跑偏：

```markdown
任务：<一个切片，一句话>
先读：PRD.md（唯一事实来源）、AGENTS.md、docs/DECISIONS.md（文件存在后）
只改这些文件：<文件列表>
不要改：<文件或目录>
先写测试：<PRD.md 里的测试编号和断言>
验收命令：pnpm gate（D1 创建它之前用 vp check && vp test，Next.js 工程建好之后再加 next build）
完成后报告：改了什么、动了哪些文件、通过了哪些检查、哪些检查只在 CI 里跑、有没有新增依赖、没验证的部分
```

涉及表结构、认证、事务、迁移时，在计划这一步停下来，由你审阅后再继续。提交前你看 diff，包括 `package.json`。

## 七天逐日计划

每天的顺序固定：先让 Flash 按计划做完当天切片，再跑 `pnpm gate`。Sonnet 5.5 全周只做一次 review，放在 D4 核心实现完成后、D5 前端开始前。

| 天 | 当天目标 | 当天验收 | 模型 |
| --- | --- | --- | --- |
| D1 | 上午（总预算 4 小时）：脚手架、Compose Postgres、Drizzle Kit 配置并连库、基础 CI、工具链、`pnpm gate`。下午（总预算 4 小时）：技术验证——API 级登录链路（含代理 Cookie）、认证表进 Drizzle 迁移（含空库迁移验收）、RPC + OpenAPI 最小链路。每项最多 2 小时 | 六项各有结论并写进 `docs/DECISIONS.md`（基础 CI、Postgres 与 Drizzle Kit 连库、认证表进 Drizzle 迁移（含空库迁移）必须真通过，不能因超时放行）；PR 上 CI 全绿 | Flash；你自己读迁移所有权和 schema |
| D2 | Better Auth、Organization、权限中间件；邀请成员（超过 2 小时跑不通则按 BR-2 退回直接添加）；浏览器里的注册、登录、退出；两个组织的隔离测试第一版（I1–I7，含 Better Auth 邀请接口和团队管理接口的权限测试；I6 仅在走邀请时适用） | 在 Docker Compose 起的本地环境里，浏览器实测能注册、登录、退出；A 组织读不到 B 组织的数据；I7 的 (a)(b) 通过（两条路径都要）；加入团队按所走的路径验收：走 Better Auth 邀请时，管理员创建邀请、邮箱匹配的用户接受邀请，I6 通过；触发 BR-2 回退（邀请超过 2 小时跑不通）时，直接添加成员接口的权限由 I1–I4 覆盖，I6 标为不适用，不得声称 I6 通过 | Flash |
| D3 | 契约定稿；创建与列出活动；报名接口（事务 + 行锁）；并发测试第一版 | 50 人并发抢 10 个名额：10 确认、40 候补、超卖 0、重复 0；K1、K2 通过 | Flash 实现；schema 与锁方案在计划阶段由你审阅 |
| D4 | 取消、候补自动递补、名额调大调小、重复点击、截止后报名；完整并发集成测试 | C3–C8 全部通过，并发测试连续跑 20 次都稳定 | Flash 实现；当天收尾后做那唯一一次 Sonnet review（范围见「模型分工」），D5 开始前处理完问题 |
| D5 | Next.js 页面：登录、活动列表与详情、报名与取消、管理页；接入 RPC 客户端 | 手工走通主流程；类型检查通过 | Flash |
| D6 | Playwright 2–3 条主流程；补全所有接口的隔离测试；日志与错误监控最小接入（选定工具后先申请依赖批准） | 本地 Docker Compose 环境里跑通主流程；A1、I1–I7 全部通过（I6 仅在走邀请时适用，回退时不得声称 I6 通过）；CI 全绿 | Flash |
| D7 | README（含已知限制）、架构图、完整演示录屏；空库从头迁移再验一遍；缓冲；可选：公网部署 | 干净克隆按 README 能 `docker compose up` 跑起来；`pnpm gate` 和 CI 全绿；录屏与 CI 记录可核对 | Flash |

## 每天收尾（15 分钟）

- 不看代码，口头讲一遍当天最核心的一段：D3–D4 讲事务与锁，D2、D6 讲权限检查，D1 讲迁移的所有权。
- 把当天做的取舍追加到 `docs/DECISIONS.md`。
- 写下明天的第一个切片和验收命令。

## 并发测试的注意点（我的建议）

- 用真实 PostgreSQL 和连接池里的多个独立连接，请求用同一个起跑信号同时发出，否则测的不是并发。
- 检查数据库最终状态（确认数、候补数、重复数、`seq` 的相对关系；队列顺序由取消后递补的测试验证），不只看 HTTP 返回码。
- 重复运行；只绿一次说明不了问题。
- 再加一个确定性的交错测试：开两个事务手动交错，A 持有活动行锁时，B 必须等待：用 `pg_stat_activity` 的 `wait_event_type = 'Lock'` 作证据，A 提交后 B 才完成；`lock_timeout` 只用来防止测试挂起，不当证据。不靠碰运气。A 用 `FOR NO KEY UPDATE` 持锁，不用 `FOR UPDATE`，否则删掉业务代码里的 `FOR UPDATE` 后这条测试仍然会绿（原因见 PRD.md 第 8 节 C7 的说明）。这条是我的建议。
- 并发与事务测试直接调用业务层函数，每个 worker 独占一条连接，起跑前断言 50 个后端 pid 互不相同；HTTP 层由 A1（状态码映射）、隔离测试和 Playwright 覆盖，C 系列只断言领域错误和数据库状态。连接预算见 PRD.md 第 8 节。
- 等锁交错测试里，用 `pg_stat_activity` 的 `wait_event` 确认 B 在等锁，不用 `sleep`；A 改截止时间要用 `clock_timestamp()`，用 `now()` 会让这条测试测不出区别（原因见 PRD.md 第 8 节）。

## 要放进仓库的文件

五个文件，全部进版本控制。规则文件要短，因为 Antigravity 对单个文件和 always\_on 规则的总量有上限（见上一节）。

### 1. `PRD.md`（已写好，另附文件）

代替原来计划的一页 `docs/intent.md`（不再创建），是这个项目的唯一事实来源。共 12 节：产品与不做、两个硬证据、业务规则与不变量、权限矩阵、数据模型、事务契约、接口、验收测试（K1–K2、C1–C8、A1、I1–I7、E1–E3）、D1 技术验证、切片与 CI 门禁、非功能要求、待定事项。标「锁定」的内容不经你同意不得改。

### 2. `AGENTS.md`（根目录，始终生效，保持很短）

```markdown
# AGENTS.md

事实来源是 PRD.md。任务与 PRD.md 冲突，或超出它的范围，停下来问我，不要自行决定。标「【锁定】」的内容不经我同意不得改。

## 栈（已锁定，不新增框架或依赖）

TypeScript、pnpm、Next.js + React + Tailwind + shadcn/ui、Hono + Zod（路由用 @hono/zod-openapi，前端用 Hono RPC）、Better Auth、PostgreSQL + Drizzle ORM/Kit、Vite+（vp）、Playwright、GitHub Actions、Docker + Compose。要加依赖，先说明理由并等我同意。

## 硬规则

1. 认证入口只在 Hono。Next.js 只做界面，不处理认证逻辑。
2. 表结构和迁移只由 Drizzle Kit 负责。不对数据库运行 Better Auth 自带的迁移。不手写迁移，不改已提交的迁移。
3. 业务表都带 `organization_id`。每个自建业务接口先过权限中间件（成员关系 + 角色），再进业务代码，每条查询都带 `organization_id`。Better Auth 的 `/api/auth/*` 是明确例外：不套用我们的组织权限中间件，由 Better Auth 自身的权限机制控制；其中的邀请和团队管理接口按 PRD.md 的 I6、I7 单独验收，不要给它们另加权限钩子。新增自建路由必须同时加进隔离测试的路由表，否则路由表完整性测试会失败；只有显式豁免清单里的路由可以不在路由表里，新增豁免须经我明确批准。
4. 报名、取消、改名额、递补：在事务内先 `SELECT … FOR UPDATE` 锁活动行，再读确认人数并写入。锁的顺序是先活动行、后报名行。业务时间判断（报名截止、活动开始）：取得活动行锁之后，用一条独立的 SQL 语句读取数据库的 `clock_timestamp()`，再据此判断（创建活动时没有活动行可锁，就在事务里同样用独立语句读取它，来校验开始时间）；不用 `now()`（它是事务开始时间，等锁期间会过期），不用应用服务器的时钟。不得在没有活动行锁的情况下据确认人数写入。
5. 测试：先写会失败的测试，确认它因功能缺失而失败，再写最小实现。不删除、不跳过、不弱化已有测试，不为变绿新建空测试。并发和隔离测试连真实 PostgreSQL，多个独立连接，断言数据库最终状态，不只看 HTTP 返回值。
6. 一次只做当前切片，不重构无关代码。密钥只放环境变量，`.env` 不提交，不在日志里输出密码、令牌、邀请链接。
7. 涉及表结构、认证、事务、迁移时，写完计划就停下，等我审阅后再动手。

## 门禁命令

以 package.json 和 CI 配置为准，D1 技术验证后把确切命令写在这里：

- 本地统一入口：`pnpm gate`。D1 定好包结构后创建，从 `vp check`、`vp test`、`next build` 起，之后随 PRD.md 第 10 节逐步加入迁移、真实 PostgreSQL 测试等。创建之前，开发门禁是 `vp check`、`vp test`，以及 Next.js 工程建好之后的 `next build`
- 合并门禁按 PRD.md 第 10 节逐步增加。只在 CI 里跑的检查，在 CI 配置和报告里如实标明，不得声称 `pnpm gate` 已经运行了它

## 完成后报告

改了什么、动了哪些文件、各项门禁的结果（哪些在 `pnpm gate` 里跑，哪些只在 CI 里跑）、有没有新增依赖、没有验证的部分。同一个失败修了两次还不过，停下来，只报告报错和相关文件，不要继续猜。
```

### 3. `.agents/rules/db.md`（只在处理数据库文件时加载）

```markdown
---
trigger: glob
globs: "**/db/**,**/drizzle/**"
---
修改表结构前先停下，把变更说明交给我审。迁移文件只能由 Drizzle Kit 生成，不手写、不改已提交的迁移。
```

注意：规则文件的头部必须写对 `trigger`，写错或缺失会被静默丢弃。写完后在 D1 用一个小问题确认它确实生效。

### 4. `.agents/skills/slice/SKILL.md`（用 `/slice` 触发）

```markdown
---
name: slice
description: 开始一个垂直切片：读上下文、写计划、等我审、先写失败的测试再实现、跑门禁、报告
---
1. 读 PRD.md（唯一事实来源）、AGENTS.md，以及 docs/DECISIONS.md（文件存在后）。
2. 写出计划：改哪些文件、新增哪些测试（引用 PRD.md 里的测试编号）、验收命令。涉及表结构、认证、事务、迁移时，停下来等我审。
3. 先写测试并运行，确认它因为功能缺失而失败。
4. 只写让测试通过的最小实现。
5. 运行 `pnpm gate`（创建它之前用 `vp check`、`vp test`，Next.js 工程建好之后再加 `next build`）。同一个失败修两次还不过，就停下，把报错和相关文件报告给我，不自行升级到别的模型。
6. 报告结果：通过的检查、只在 CI 里跑的检查、有没有新增依赖、没有验证的部分。
```

### 5. `docs/DECISIONS.md` 的条目格式

```markdown
## 2026-10-13 认证入口放在 Hono
- 选择：Better Auth 挂在 Hono，Next.js 只做界面
- 原因：只维护一个入口
- 备选：认证放 Next.js（放弃，要在两边维护会话）
- 验证：D1 API 级登录、读取会话、退出跑通（curl 带 cookie 文件）；D2 浏览器里实测
```

## 防翻车规则与未核实项

用 Flash 大量写代码，最大的风险是测试看起来是绿的，其实什么也没证明。下面是我建议的防线，其中第 1 条最重要。

## 怎么验证 AI 写的代码

1. **拿掉锁，再看并发测试变不变红（诊断，不是保证）。** 写完并发代码和测试后，临时删掉 `FOR UPDATE`，再跑 C1、C4、C7。C7 是确定性的交错测试，必须变红；C1、C4 是并发压力场景，结果受调度影响，只作补充诊断，不要求每次都单独变红。C7 没变红，先查它有没有真的观察到 B 在等锁、A 的持锁模式对不对（见 PRD.md 第 8 节 C7 的说明）；C1、C4 多次都没暴露异常，再查竞态窗口太小、请求不是同时发出。不要默认测试有效，也不要默认代码有错。最终标准是数据库里的结果——10 确认、40 候补、超卖 0、重复 0——而不是 HTTP 返回值。验证后把锁加回去。另做一次：临时把业务时间判断从 `clock_timestamp()` 换成 `now()`，C6 的等锁交错用例应当变红。
2. **先看测试失败。** 每个切片先写测试并确认它因为功能缺失而失败，再写实现。
3. **隔离测试要覆盖所有接口。** 把全部受保护的路由列成一张表，对每一行做「跨组织访问被拒绝」的参数化测试，新增路由必须同时加一行；不属于权限矩阵的路由（`/api/auth/*`、`/doc`、健康检查）写进显式豁免清单，新增豁免要你批准。被豁免的 Better Auth 邀请接口和团队管理接口，权限由 I6、I7 单独测。
4. **不许删改测试来过门禁。** 已写进 `AGENTS.md`；提交前看 diff 里有没有测试文件被削弱。
5. **看 package.json 的 diff。** Flash 容易顺手加依赖，不是你要的就删掉。
6. **每个切片一个分支、一次提交。** 提交前看版本控制面板里每个文件的改动，不只看测试结果。
7. **并发测试重复跑。** 连续跑 20 次都稳定才算通过，这是我的建议。

## 必须自己读懂的部分

事务与行锁的代码、权限中间件、Drizzle schema 与唯一约束、迁移流程（谁生成、谁执行）、Better Auth 的 Cookie 与 `trustedOrigins` 配置、CI 配置。面试会追问的正是这些。对应的八股在「数据库」一节的事务、隔离级别、索引三题。

## 哪些切片必须停下来人工审

涉及表结构、认证、事务、迁移的切片，在 Antigravity 里保持计划审阅，计划你没看懂就不要点继续。Sonnet 额度只够一次，这一步是平时对这些部分唯一的把关。

## 我没有核实的事项

- Hono RPC 与 `@hono/zod-openapi` 能否直接配合：ChatGPT 说官方仓库有直接实例和相关修复，但我打不开 README，没能自己验证，所以放在 D1 实测。
- Better Auth 经 Next.js 同源代理后的 Cookie 与 `trustedOrigins` 行为：文档只给了跨域配置，代理方案没有现成保证。
- Better Auth 的 Drizzle 适配器与 schema 生成命令：Organization 插件页没有明说，ChatGPT 说官方提供，我没有单独核对。
- `vp check` 对 Next.js 项目是否好用：Vite+ 1.0 公告没提 Next.js 的支持。
- Antigravity 的 IDE 里 `/slice` 这种技能触发是否可用，以及规则头部是否真的生效：文档没写清，D1 实测。
- Gemini 3.8 Flash 的基准数字是 Google 自己跑的，我查到时没有独立复现；我也没有查到 Claude Sonnet 5.5 的对应数据，所以上面的分工依据是我的判断，不是实测。
- Antigravity 的额度没有公布具体数字；你的套餐能用 Sonnet 5.5，但额度只够一次整体 review（你自己的使用情况，我没法核实）。
- PostgreSQL 的 `now()` 与 `clock_timestamp()` 的区别、`max_connections` 默认通常 100、`superuser_reserved_connections` 默认 3、`reserved_connections` 默认 0：已对照官方文档核实。镜像或 Compose 可能改过连接数，D1 用 `SHOW` 实测这三个参数（`reserved_connections` 在所用版本有的话）。
- Better Auth 默认角色的邀请权限（owner、admin 可以创建邀请，member 不可以）和「接受邀请要求登录邮箱与邀请匹配」：已对照官方文档核实。被拒绝时返回什么状态码，文档没写，D2 实测后写进 PRD 的 I6 行。
- Better Auth 团队管理接口：删除团队的选项，官方页的代码示例写 `disableOrganizationDeletion: true`，正文却写 `organizationDeletion`，前后不一致，D2 以所装版本的类型定义为准。官方只说 admin「不能删除团队、不能更改 owner」，没有明说 admin 能否移除 owner。这些默认行为用 I7 实测，实测与文档不符时停下来报告。
- 邀请接受是否要求邮箱已验证：官方页说内置的随机 id 走正常邀请流程；改用可预测的 id（`serial` 等）才要求已验证。所以 D2 不改 id 生成方式；不发邮件时邀请能否走通，仍按上一条实测。
- 等锁交错测试里用 `pg_stat_activity` 的 `wait_event` 判断 B 在等锁：我没有在这个项目里实跑，D3–D4 实测。
- C7 的持锁模式：锁冲突表（`FOR UPDATE` 与 `FOR KEY SHARE` 冲突，`FOR NO KEY UPDATE` 与它不冲突）已对照 PostgreSQL 官方文档核实；外键检查对被引用行加 `FOR KEY SHARE`，我引的是 CYBERTEC 的文章，没有对照官方文档，也没有在本项目实跑。D3 实测：A 用 `FOR NO KEY UPDATE`，删掉 `FOR UPDATE` 后 C7 必须变红；再临时让 A 改用 `FOR UPDATE`，同样删掉 `FOR UPDATE`，C7 应当仍然是绿的，用来证实这条推理。
- 公网部署：已降为可选加分项，见「交付标准与部署」。具体平台的价格、免费额度和大陆访问速度我没有逐个查，真要做时必须实测。
- EvidenceOS：你已确认干净克隆验收完成；我没有看到那个仓库，没有独立核实。
- Better Auth 邀请在不发邮件时能否正常创建和接受：文档说必须提供 sendInvitationEmail，没说回调只记日志是否可行，也没写清创建邀请的返回值；D2 实测，超过 2 小时就退回管理员直接添加。
- 分支保护：公开仓库在 GitHub Free 下可用，已对照官方文档核实；新仓库还没创建，D2 实际配置时再确认。
- Drizzle 的部分唯一索引（只对有效报名唯一）能否正确生成迁移：我没查文档，D3 实测。

## 来源

- [Antigravity：功能总览](https://antigravity.google/docs/features/)
- [Antigravity：规则](https://antigravity.google/docs/rules)
- [Antigravity：技能](https://antigravity.google/docs/skills)
- [Antigravity：模型与额度](https://antigravity.google/docs/models)
- [Antigravity：实现计划](https://antigravity.google/docs/implementation-plan)
- [Gemini 3.8 Flash（CellCog）](https://cellcog.ai/blog/gemini-3-8-flash/)
- [Gemini 3.8 Flash（Fello AI）](https://felloai.com/gemini-3-8-flash/)
- [Announcing Vite+ 1.0](https://voidzero.dev/posts/announcing-vite-plus-1-0)
- [Better Auth：Hono 集成](https://better-auth.com/docs/integrations/hono)
- [Better Auth：Organization 插件](https://better-auth.com/docs/plugins/organization)
- [Hono：RPC 指南](https://hono.dev/docs/guides/rpc)
- [PostgreSQL：日期时间函数（now、clock_timestamp）](https://www.postgresql.org/docs/current/functions-datetime.html)
- [PostgreSQL：连接设置（max_connections）](https://www.postgresql.org/docs/current/runtime-config-connection.html)
- [PostgreSQL：显式锁定（行级锁冲突表）](https://www.postgresql.org/docs/current/explicit-locking.html)
- [CYBERTEC：SELECT FOR UPDATE considered harmful（外键检查加的行锁）](https://www.cybertec-postgresql.com/en/select-for-update-considered-harmful-postgresql/)
- [GitHub：关于受保护的分支](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Vercel：从中国大陆访问 Vercel 托管的站点](https://vercel.com/kb/guide/accessing-vercel-hosted-sites-from-mainland-china)
- [Cloudflare China Network：Get started](https://developers.cloudflare.com/china-network/get-started/)
- [工信部：非经营性互联网信息服务备案管理办法](https://www.miit.gov.cn/zcfg/xxtxl/art/2024/art_7e48434c08c24131b4b7eecfca5b2b6c.html)
