# More More Code 项目核心分析

> 本文基于当前仓库代码整理，重点覆盖项目架构、核心数据结构、已实现功能、关键流程及当前边界，不展开逐文件说明。

## 1. 项目定位

More More Code 是一个 local-first 的终端 Coding Agent 原型。CLI 是真正的应用与 Agent Runtime：负责 TUI、Harness、模型调用、Tool Loop、本地工作区操作和消息编排；Hono Server 不参与模型执行，只承担云端 Session 持久化、恢复数据和必要的账户服务。

项目当前的核心闭环为：

1. 用户在终端输入消息，CLI 创建 Harness Run；
2. Harness 创建 `initial` Turn 并执行一个本地 Model Step；
3. 模型产生 Tool Call 时，CLI 在同一 Turn 内执行对应 Tool Steps；
4. Tool 结果需要继续推理时，Harness 创建新的 `tool-continuation` Turn；
5. Run 活跃期间，Enter 可排队 steering、Alt+Enter 可排队 follow-up，均只在 Turn-safe boundary 消费；
6. Run 完成后，UIMessage/Session Tree state 通过 Session Store 同步到 Server / PostgreSQL；
7. 再次进入会话时，从云端快照恢复消息历史后继续由本地 Runtime 执行。

## 2. 技术栈与仓库结构

项目采用 Bun Workspaces 管理，根目录通过 `packages/*` 组织五个内部包。

| 包 | 主要技术 | 职责 |
| --- | --- | --- |
| `packages/cli` | React 19、OpenTUI、AI SDK、Provider SDK、Hono RPC Client | 本地应用层：UI、模型调用、消息编排、本地工具执行、云会话同步 |
| `packages/harness` | TypeScript | Agent Loop、Execution Events/Event Store、Run / Turn / Step Lifecycle/Projection、steering/follow-up、Context/Session Runtime |
| `packages/server` | Bun、Hono、Sentry | 云服务层：会话持久化、会话恢复数据、认证及外围账户 API |
| `packages/database` | Prisma 7、PostgreSQL、`@prisma/adapter-pg` | 云 Session Store 数据模型、Prisma Client、数据库连接 |
| `packages/runtime-store` | Prisma 7、SQLite、`@prisma/adapter-libsql` | 本地 Runtime Event / Snapshot 持久化与恢复 adapter；兼容 Bun 运行时 |
| `packages/shared` | TypeScript、Zod | 模型清单、价格信息、消息结构及流式事件协议 |

根脚本提供两个主要开发入口：

```bash
bun run dev:server
bun run dev:cli
```

服务端默认监听 `3000` 端口；CLI 默认连接 `http://localhost:3000`，也可通过 `API_URL` 修改。

## 3. 整体架构

```text
用户
  │
  ▼
OpenTUI + React CLI
  │
  ▼
Agent Harness Runtime
  │  AgentLoop → Lifecycle + Execution Events → Run/Turn/Step Projection
  │  Turn = one Model response + requested Tool Steps
  │  Model Step: CLI LocalModelTransport → Provider API
  │  Tool Step: CLI 本地执行
  │
  ├──────────────► LLM Provider
  │
  └─ best-effort session sync
          ▼
Hono Server
  ├── /sessions：会话创建 / 查询 / Session Tree 状态持久化
  ├── /auth：云账户认证
  └── Sentry：云服务日志与异常
          │
          ▼
Prisma Client
  │
  ▼
PostgreSQL
```

Harness 包位于 CLI 的执行路径中，负责显式驱动 Run → Turn → Step。Turn 定义为一次 Model response 加该 response 请求的全部 Tool Steps；后续 tool-result 推理会创建新的 Turn。AgentLoop 将 coarse-grained Run / Turn / Step 事实写成 append-only Execution Events，`AgentRun` 等状态通过 replay projection 得到，同时通过 awaited lifecycle stream 对外发送 `run_start/end`、`turn_start/end`、`step_start/update/end`。模型 Provider、System Prompt 与 `streamText()` 同样位于 CLI。Server 不参与 Agent Run，只接收会话快照用于云端恢复。

Stage 6.0 将持久化边界拆为两个独立 Prisma store：`packages/database` 继续使用 PostgreSQL 服务云 Session；`packages/runtime-store` 使用 SQLite 保存本地 Runtime Event 与 Runtime Snapshot。二者拥有独立 schema/client/migration。Session Tree 是语义会话权威，Runtime Event 则为执行、安全、上下文和恢复事实；本地 store 不进入云同步关键路径。

## 4. 核心数据结构

### 4.1 Session（会话）

`Session` 表示一段独立对话。

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `id` | String / CUID | 会话主键 |
| `userId` | String | 云账户用户标识 |
| `title` | String | 会话标题 |
| `createdAt` | DateTime | 创建时间 |
| `updatedAt` | DateTime | 自动更新时间 |
| `messages` | Json | CLI UIMessage 会话快照，用于恢复 |

`messages` 当前采用 JSON 快照，而不是独立 Message 表。它是云同步格式，不等价于 Harness 的 Run / Turn / Step 事件模型。

### 4.2 Message（消息）

CLI 内部使用 AI SDK `UIMessage` 表示用户输入、模型输出和 Tool Call/Result；Server 仅将其作为 Session 的 JSON 快照保存。

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `id` | String / CUID | 消息主键 |
| `sessionId` | String | 所属会话 ID |
| `role` | Role | `USER`、`ASSISTANT` 或 `ERROR` |
| `status` | MessageStatus | `COMPLETE` 或 `INTERRUPTED` |
| `model` | String | 本条消息使用的模型 ID |
| `content` | String | 最终文本内容 |
| `parts` | Json? | 为推理、文本、工具调用等结构化内容预留 |
| `mode` | Mode | `BUILD` 或 `PLAN` |
| `duration` | Int? | 模型回答耗时 |
| `createdAt` | DateTime | 消息创建时间 |

消息通过 `sessionId` 关联会话；删除会话时，消息会通过级联关系一并删除。当前主要实际使用 `content`，`parts` 尚未贯穿服务端持久化和 CLI 展示。

### 4.3 消息分段协议

共享包定义了最终消息可包含的三类分段：

- `text`：普通文本；
- `reasoning`：推理文本；
- `tool-call`：工具名称、参数、调用 ID 和可选结果。

CLI 当前只实现文本分段的消费和展示，因此推理内容与工具调用属于协议预留能力，还不是完整可用功能。

### 4.4 SSE 流式事件

服务端与 CLI 约定以下事件：

- `text-delta`：回答文本增量；
- `reasoning-delta`：推理内容增量；
- `tool-call`：模型发起工具调用；
- `tool-result`：工具执行结果；
- `done`：回答完成，携带消息 ID 和耗时；
- `error`：流式处理失败。

当前服务端实际发送的主要是 `text-delta`、`done` 和 `error`。

## 5. 已实现功能

### 5.1 终端交互界面

CLI 使用 OpenTUI + React 渲染，包含：

- 首页输入框；
- 新会话创建过渡页；
- 会话消息页；
- 用户消息、助手消息、错误消息的差异化展示；
- 自动滚动的消息区域；
- 流式回答加载状态；
- Build/Plan、模型名称和耗时状态展示；
- Enter 提交、Shift+Enter 换行；
- Ctrl+C 优先清空当前输入；
- Toast、Dialog、键盘层级和主题 Provider。

路由目前全部存在于内存中：

- `/`：首页；
- `/sessions/new`：创建会话；
- `/sessions/:id`：会话详情。

### 5.2 命令菜单

输入 `/` 可使用命令菜单。当前命令包括：

- `/new`
- `/agents`
- `/models`
- `/sessions`
- `/theme`
- `/login`
- `/logout`
- `/upgrade`
- `/usage`
- `/exit`

其中主题选择和退出具备实际行为；其余多为 Toast、占位 Dialog 或“coming soon”提示，尚未连接真实业务。

### 5.3 会话管理 API

服务端仅提供云会话状态能力：

| 方法 | 路径 | 功能 |
| --- | --- | --- |
| GET | `/sessions/` | 按创建时间倒序返回会话摘要 |
| GET | `/sessions/:id` | 返回完整 Session 快照 |
| POST | `/sessions/` | 创建云 Session |
| POST | `/sessions/:id/state` | 保存 CLI 当前 versioned Session Tree state |
| POST | `/sessions/:id/messages` | 旧版线性消息快照兼容接口 |

Server 不提供 `/chat` 或 `/resume` 模型执行接口。

### 5.4 本地 Agent / Model 执行

模型调用由 CLI 的 `LocalModelTransport` 直接发起。每个 Model Step 先把当前消息映射成 Harness `ContextRecord`，由 `ContextManager` 按输入预算生成 `ContextProjection`，再将投影结果转换为 ModelMessage 并调用 AI SDK `streamText()`；Harness 根据返回的 Tool Call 在当前 Turn 内执行 Tool Steps，并在工具链结束后决定启动 `steering`、`tool-continuation`、`follow-up` Turn，或结束 Run。

Server 只通过 Session Store 接收会话树状态快照，因此云同步失败和 Agent Run 失败属于两个不同的故障域。

### 5.5 流式中断与恢复

CLI 通过 Escape 请求中断当前 Run；Model Step 可立即 abort，本地 Tool Step 由 Tool Runtime 传播同一个 AbortSignal。Bash executor 使用受监控的进程组，取消时会终止后代进程并等待命令组退出，避免 Tool 已返回但孙进程仍持有 workspace。Harness 依次追加对应 step/turn/run terminal execution events，并由事件 replay 得到中断状态。`run_end` lifecycle listeners 属于 settlement barrier，因此 Run projection 可能已 terminal，但 `isBusy` 会一直保持到 listeners 完成，`waitForIdle()` 才返回。

Run 活跃期间，普通 Enter 将输入排入 steering queue；Alt+Enter 排入 follow-up queue。steering 在当前 Turn 完成后优先于自动 tool continuation，follow-up 只在 Run 原本将进入 idle 时消费。云端恢复仍基于 versioned Session Tree snapshot；本地执行恢复则默认使用 `~/.more-more-code/runtime/runtime.db` 中的 session-scoped Runtime Event/Snapshot。CLI 通过 `RuntimeSession` 在 Model/Tool 副作用前执行 awaited write-ahead append，恢复 snapshot 后的 event、预热 Projection Cache，并把未完成 Run/操作报告给 UI；它只重建状态，不自动重复外部调用。Cloud revision/conflict sync 仍未实现。

### 5.6 多模型抽象

共享包维护模型 ID、厂商和输入/输出 Token 单价。当前清单涉及：

- OpenAI；
- Anthropic；
- Mistral；
- Google；
- DeepSeek。

CLI 通过 AI SDK 将模型 ID 解析为具体 Provider 实例。默认模型为 `deepseek-v4-flash`。

需要注意：当前解析器只真正实现了 OpenAI、Anthropic 和 DeepSeek。Mistral、Google 虽出现在共享模型清单中并能通过请求校验，但实际调用时会进入“不支持 Provider”的异常分支。

### 5.7 可观测性

服务端集成 Sentry：

- 捕获 Hono/Bun 请求异常；
- 记录会话创建、查询、校验失败等结构化日志；
- 启用 Trace；
- 提供 `/debug-sentry` 测试异常和指标接口；
- 全局错误处理统一返回 JSON 500。

## 6. 关键业务流程

### 6.1 首次发起会话

```text
首页输入消息
  → POST /sessions 创建云 Session
  → 跳转 /sessions/:id
  → CLI 创建 Run / initial Turn execution events
  → ExecutionEventStore / Projection 建立当前 Run 状态
  → LocalModelTransport 直接调用模型 Provider
  → Tool Call 时由 CLI 在当前 Turn 内执行 Tool Steps
  → Turn End 后按 steering → tool-continuation → follow-up 的规则决定下一 Turn
  → 无待处理工作时 Run End
  → completed Run 追加 Session Tree child node
  → versioned Session Tree state 同步到 Server
```

### 6.2 会话内继续提问

```text
用户在 idle 时提交文本
  → CLI 创建新的 Run / initial Turn
  → Run / Turn / Step 状态由 event replay 投影
  → 本地 Model Step 流式更新 UI
  → 本地 Tool Step 执行工作区操作
  → 运行中 Enter 可 queue steering，Alt+Enter 可 queue follow-up
  → Harness 仅在 Turn-safe boundary 消费队列并决定下一 Turn
  → Run 完成 / 中断 / 失败
  → completed Run 追加当前 active node 的 child
  → Session Store 将完整 Session Tree snapshot 同步到云端
```

### 6.3 错误处理

- 请求参数错误：返回 400；
- 会话不存在：返回 404；
- 无可恢复用户消息或重复恢复：返回 409；
- 模型生成错误：保存 `ERROR` 消息，并通过 SSE 发送 `error`；
- 未处理服务端异常：记录日志并返回统一 500；
- CLI 网络或协议解析错误：追加本地错误消息，并通过 Toast 处理页面级错误。

## 7. 配置与运行依赖

项目运行至少依赖：

- Bun；
- PostgreSQL（云 Session Store）；
- SQLite（本地 Runtime Store，无独立服务进程）；
- `DATABASE_URL`；
- 所选模型 Provider 对应的 API Key；
- 可选的 `API_URL`。

云数据库代码在缺少 `DATABASE_URL` 时会在模块加载阶段直接抛错。云端与本地 Prisma Client 分别输出到 `packages/database/generated/prisma` 和 `packages/runtime-store/generated/prisma`，必须通过各自包的 `db:generate` 脚本独立生成。

## 8. 当前实现边界与值得关注的问题

以下内容是基于当前代码确认的主要边界：

1. **Provider 依赖刚从 Server 迁到 CLI**
   `packages/cli/package.json` 已声明 Provider SDK，但当前工作区需要重新执行一次 `bun install` 才会重建 workspace node_modules 链接。

2. **模型清单与实际 Provider 支持仍不完全一致**
   当前本地 resolver 实现 OpenAI、Anthropic 和 DeepSeek；其他模型应在清单或 resolver 层统一处理。

3. **云 Session 已升级为 Session Entry Tree v3，但同步仍是 last-write-wins**
   v3 直接持久化 append-only `entries[]`；message、tool、runtime-state change、compaction 与 branch summary 都是可分支的 Session Entries，旧 linear/v1/v2 状态在 CLI 恢复时兼容升级。`POST /sessions/:id/state` 仍没有 revision / optimistic concurrency / conflict resolution。

4. **Durable Runtime Store、有效权限策略与派生安全审计已成为完整安全基础**
   Run / Turn / Step 通过 `RuntimeSession` 串行写入并投影本地 SQLite events；snapshot failure 不再把已提交 append 误报为失败。Tool Runtime 使用 Harness 的统一 `allow | deny | ask` contract，把 code defaults、global config 与 project config 合成为 last-match-wins effective policy，并按 command/path/resource/scope 在 executor 前执行；构造 Tool Runtime 必须显式注入 PermissionPolicy，不再存在隐式 allow-all。Tool/Context/system 使用严格白名单 v1 payload；permission lifecycle 使用可兼容旧 decision 的 v2 request/decision payload。Harness 的 `projectSecurityAuditTimeline` 直接从 session-scoped Runtime Events 派生审计视图，关联 v2 request/decision 与 Tool terminal、保留 v1 legacy decision，并检测缺失/重复/乱序、metadata mismatch 及 permission-terminal 冲突。Replay 只验证 lifecycle consistency，不从脱敏事件伪造 policy recomputation；审计历史也不复制进 RuntimeSession snapshot。

5. **Tool cancellation 已贯通，但仍不是 OS-level Sandbox**
   Tool Runtime 已统一 timeout/cancellation，Bash 会终止受监控的进程组，支持 AbortSignal 的文件操作也会协作取消；路径检查与进程取消仍不能替代命令、网络、资源和权限范围的系统级隔离。

6. **Context reduction 已形成 Tool Working Set + Branch Summary + semantic Compaction 三种独立语义，但 tokenizer 仍是显式估算器**
   Tool Result Working Set 先对过大的 warm/cold shell、test/build、search/grep、file-read、generic 输出做 model-facing `truncated/summary/reference` 投影，canonical `tool_result` 不变。Branch Summary 则在跨路径导航确实会丢失 source-only 语义知识时按 `ask | always | never` 做 lazy transfer；Carry 使用独立 bounded reducer（上限 `min(4096, 4% input budget)`），并以 provenance/coverage 去重，No Carry/Cancel 均不制造 Session branch。Active-path Branch Summary 作为 historical Context record 参与普通 Compaction；checkpoint 使用 generic record IDs 防止已吸收知识重复投影。历史 Compaction 仍按 80% soft / 92% hard / 70% target 和完整 group/Turn cut point运行，`/compact` 复用同一 checkpoint pipeline并执行安全 eligibility gate。Harness 同时提供 exact tokenizer adapter 接口，但当前模型家族仍使用明确标记为 `estimated` 的计数器。

7. **云同步暂时是 best-effort**
   同步失败不会让本地 Agent Run 失败，这是正确的故障域隔离；本地 Runtime Event 已持久化，但语义 Session 云同步仍只有日志，没有 retry queue、revision conflict resolution 或离线同步队列。

8. **Server 仍保留 auth / billing 外围路由**
   它们不参与 Agent Runtime。如果最终要求 Server 严格只做 Session Storage，可进一步把 billing 拆为独立账户服务。

9. **测试覆盖仍需扩展**
   已有 AgentLoop、ExecutionEventStore/Projection、Runtime Store migration/restart、write-ahead/redaction/recovery、LocalModelTransport Context lifecycle、Tool Runtime 和 Session Tree 回归测试，但还缺真实 Cloud Session Sync、完整 CLI 键盘/节点跳转 UI 与真实多轮 Tool Loop 的端到端集成测试。

10. **可观测性配置偏开发态**
    Sentry DSN 仍直接写在代码中，Trace 采样率较高，并保留测试异常路由，上线前应环境化。

## 9. 项目现阶段总结

项目现在的核心性质已经从“Client + 远程 AI Chat Server”转为“**Local Coding Agent Runtime + Cloud Session Store**”。CLI 是 authoritative execution runtime；Server 只是云数据边界，不参与 Run / Turn / Step 的推进。

现阶段最核心的已完成能力是：

- 显式 AgentLoop、append-only Execution Events 与 Run / Turn / Step projection；
- pi-style Run/Turn/Step lifecycle，Turn = Model response + requested Tools；
- awaited lifecycle stream、`waitForIdle()` 与 settlement-aware `isBusy`；
- Turn-safe steering / follow-up queue；
- CLI 本地 Model Step 与 Tool Step；
- 终端流式交互和中断；
- 云端 Session 创建、读取和 Session Entry Tree v3 snapshot 同步；
- Session Entry Tree v3、任意 Entry 投影、lazy navigation 与 coverage-aware Branch Summary knowledge transfer；
- Harness ContextManager、ModelContextProfile、Turn-aware token budget、retained tail、Tool Result Working Set 与 automatic/manual semantic Compaction；
- 多 Provider 的本地抽象；
- 默认启用的本地 SQLite Runtime Store、严格脱敏 Runtime Event、snapshot-plus-replay recovery 与未完成工作提示；
- Harness 统一 permission policy、global/project persisted overrides、Tool Runtime capability enforcement 与脱敏 permission lifecycle；
- 派生 security audit timeline、v1/v2 lifecycle consistency replay 与 dangerous-operation enforcement validation；
- AgentLoop / lifecycle interaction / ExecutionEventStore / Execution Projection / ContextManager / Session Tree 确定性测试基础。

Stage 6.0 的 security audit projection、旧 v1 / 新 v2 permission lifecycle consistency replay 与危险操作策略覆盖已经完成。后续优先级应转向独立的 MCP transport/auth、交互式 approval、OS-level Sandbox 或 Cloud revision/conflict sync；这些能力不应重新塞回 AgentLoop。精确 tokenizer 仍可作为 provider adapter 的独立增强项。
