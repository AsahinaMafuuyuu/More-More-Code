# More More Code 项目核心分析

> 本文基于当前仓库代码整理，重点覆盖项目架构、核心数据结构、已实现功能、关键流程及当前边界，不展开逐文件说明。

## 1. 项目定位

More More Code 是一个 local-first 的终端 Coding Agent 原型。CLI 是真正的应用与 Agent Runtime：负责 TUI、Harness、模型调用、Tool Loop、本地工作区操作、消息编排和 Session 持久化；Hono Server 不参与模型执行，也不在当前 CLI 路径中参与 Session 生命周期。Stage 6.4 Provider Runtime 与 Stage 6.5 Local Session Authority & Railway Retirement 已交付：本地 CLI 不依赖 Server、账户、`API_URL`、Cloudflare Worker 或 Railway。Server/database 仅作为暂停中的未来云能力保留，Stage 6.6 同步/商业账户工作须重新获得产品批准。

项目当前的核心闭环为：

1. 用户在终端输入消息，CLI 创建 Harness Run；
2. Harness 创建 `initial` Turn 并执行一个本地 Model Step；
3. 模型产生 Tool Call 时，CLI 在同一 Turn 内执行对应 Tool Steps；
4. Tool 结果需要继续推理时，Harness 创建新的 `tool-continuation` Turn；
5. Run 活跃期间，Enter 可排队 steering、Alt+Enter 可排队 follow-up，均只在 Turn-safe boundary 消费；
6. 每个语义 Session 转换先由本地 SQLite `LocalSessionStore` 事务性提交，成功后才暴露给 UI 或触发 Provider/Tool 副作用；
7. 再次进入会话、继续、分支、Context checkpoint/cache、Provider Usage/Cost/Cache telemetry 和重启恢复均走本地 Session/Runtime Store；StatusBar 的 Context 占用来自 canonical Context 投影，累计 API 费用来自 Provider Usage + 每 Step 固化 pricing basis，显式导入 legacy linear/v1/v2/v3 快照仍是非阻断 follow-up，尚未实现。

## 2. 技术栈与仓库结构

项目采用 Bun Workspaces 管理，根目录通过 `packages/*` 组织七个内部包。

| 包 | 主要技术 | 职责 |
| --- | --- | --- |
| `packages/cli` | React 19、OpenTUI、AI SDK、Provider SDK | 本地应用层：UI、Local Session authority、模型调用、消息编排、本地工具执行 |
| `packages/harness` | TypeScript | Agent Loop、Execution Events/Event Store、Run / Turn / Step Lifecycle/Projection、steering/follow-up、Context/Session Runtime |
| `packages/session-store` | TypeScript、SQLite/libSQL | 本地 Session Entry Tree semantic authority；migrations、事务、topology、idempotency |
| `packages/server` | Bun、Hono、Sentry | dormant future cloud service；不在本地 CLI 关键路径 |
| `packages/database` | Prisma 7、PostgreSQL、`@prisma/adapter-pg` | dormant future cloud persistence；Stage 6.6 才可能演进为 optional sync/account boundary |
| `packages/runtime-store` | Prisma 7、SQLite、`@prisma/adapter-libsql` | 本地 Runtime Event / Snapshot 持久化与恢复 adapter；兼容 Bun 运行时 |
| `packages/shared` | TypeScript、Zod | 模型清单、价格信息、消息结构及流式事件协议 |

根脚本提供本地 CLI 开发入口；Server 脚本仅供维护暂停中的未来云代码：

```bash
bun run dev:cli
```

本地 CLI 不读取 `API_URL`，也不要求启动 Server。Session Store 默认位于
`~/.more-more-code/sessions/sessions.db`，Runtime Store 默认位于
`~/.more-more-code/runtime/runtime.db`；两者都可通过各自的绝对 `file:` URL
环境变量覆盖。

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
  │  LocalSessionStore：Session Tree semantic authority
  │  Model Step: ProviderRegistry/ModelRef → CLI LocalModelTransport → Provider API
  │  Tool Step: CLI 本地执行
  │
  ├──────────────► Local SQLite Session Store
  ├──────────────► Local SQLite Runtime Store
  │
  └──────────────► LLM Provider APIs（本地直连）

未来 Cloud（dormant；Stage 6.6 paused）
  └── Server/database：仅保留待重新批准的账户、Entitlement、sync/backup 边界
```

Harness 包位于 CLI 的执行路径中，负责显式驱动 Run → Turn → Step。Turn 定义为一次 Model response 加该 response 请求的全部 Tool Steps；后续 tool-result 推理会创建新的 Turn。AgentLoop 将 coarse-grained Run / Turn / Step 事实写成 append-only Execution Events，`AgentRun` 等状态通过 replay projection 得到，同时通过 awaited lifecycle stream 对外发送 `run_start/end`、`turn_start/end`、`step_start/update/end`。模型 Provider、System Prompt 与 `streamText()` 同样位于 CLI。LocalSessionStore 负责 Session semantic state，Local Runtime Store 负责执行、安全、Context 和恢复事实；Server/database 不参与本地 Agent Run 或 Session 生命周期。

Stage 6.0 将 Runtime 持久化边界拆为独立的 `packages/runtime-store` SQLite store；Stage 6.5 又新增 `packages/session-store` SQLite semantic store。二者拥有独立 schema/client/migration。Session Store 保存 Session Tree、metadata、topology、active cursor 与 semantic Entries；Runtime Store 保存执行、安全、上下文和恢复事实，不能互相取代。

ADR-0023/0024 进一步区分了“Session 语义权威”和“Cloud Sync”：Stage 6.5 已使 LocalSessionStore 成为物理持久化 authority。前 Cloud Session Store 的 whole-tree snapshot 路径已退出 CLI；Stage 6.6 未来才可能在其上实现 append-oriented、revision/cursor-aware 的多设备同步，目前处于暂停状态。

## 4. 核心数据结构

### 4.1 Session（会话）

`Session` 表示一段独立对话，由本地 `LocalSessionStore` 管理。

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `id` | String / CUID | 会话主键 |
| `metadata` | JSON | 本地 Provider/model/mode 及其他 Session 元数据 |
| `title` | String | 会话标题 |
| `rootEntryId` | String | `session_start` 根 Entry 标识 |
| `activeEntryId` | String | 当前本地继续/分支游标 |
| `createdAt` | number | 创建时间戳 |
| `updatedAt` | number | 最近本地提交时间戳 |
| `revision` | number | 本地提交修订号 |
| `archivedAt` | number? | 本地归档时间戳 |

Session Entry Tree 由独立的 `entries[]` 组成，每个 durable semantic event 都是带 `id / parentId / type` 的树节点。Store 以事务持久化 metadata、active cursor、Entry topology 和稳定 sequence，并对重复 Entry 做幂等处理；它不与 Harness 的 Run / Turn / Step Runtime Events 混用。

### 4.2 Message（消息）

CLI 内部使用 AI SDK `UIMessage` 表示用户输入、模型输出和 Tool Call/Result，但 AI SDK assistant `UIMessage` 是运行时/UI 聚合对象，不再被视为 durable semantic identity。Tool continuation 可以复用同一个 `UIMessage.id` 并追加新的 Model Step；CLI 会按 AgentLoop `stepId` 为每个 completed Model Step 派生独立 durable assistant message id，并按最后一个 `step-start` 只提取当前 step parts 后写入 Local Session Store。Server/database 不参与本地 Session 恢复。

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

CLI 会消费并展示文本、reasoning 与 Tool 相关的归一化分段；对应的 Tool call/result 语义作为独立 canonical facts 进入本地 Session Entry Tree。Tool terminal output 不再通过 normal `message_update` 写回 assistant Entry，而由 Message Projection 从 `tool_result` 推导；Navigation Projection 则把 call/result 显示为一个 derived ToolUse。当前会话 transcript 中的 ToolUse 也不再直接解释 AI SDK part：CLI 会把 live Tool part、canonical call/result、当前 Agent Activity Tool Step 和 process-local Approval 汇总为纯 ToolUse projection，且 canonical terminal 永远优先。

### 4.4 流式事件与兼容协议

当前 Model streaming 由 CLI 通过 AI SDK 直接连接 Provider，再归一化为 UI 消息和 Harness lifecycle；不经过 Server。共享包仍保留以下历史/兼容事件形状：

- `text-delta`：回答文本增量；
- `reasoning-delta`：推理内容增量；
- `tool-call`：模型发起工具调用；
- `tool-result`：工具执行结果；
- `done`：回答完成，携带消息 ID 和耗时；
- `error`：流式处理失败。

这些事件不是本地 Session authority，也不是当前 CLI 的云端依赖；Server 侧旧 SSE 路径仅作为 dormant future-cloud 代码维护。

## 5. 已实现功能

### 5.1 终端交互界面

CLI 使用 OpenTUI + React 渲染，包含：

- 首页输入框；
- 新会话创建过渡页；
- 会话消息页；
- 用户消息、助手消息、错误消息的差异化展示；
- 自动滚动的消息区域；
- 流式回答加载状态；
- Conversation 与 Input 之间的 Agent Activity 区域，直接展示当前 Run/Turn/Model Step/Tool Step 状态、Turn cause、耗时和可用 progress；
- 可展开的语义 ToolUse，明确区分 requested/running/completed/failed/cancelled/timed-out/denied/approval-waiting/incomplete，并对历史缺失 terminal 状态 fail-closed；
- Build/Plan、模型名称和耗时状态展示；
- Enter 提交、Shift+Enter 换行；
- Ctrl+C 优先清空当前输入；
- Toast、Dialog、键盘层级和主题 Provider。

当前 UI 功能已经能够消费本地 Runtime/Session authority，但应用层架构仍处于整改阶段：`useChat` 同时承担较多 Session/Runtime 协调与 UI projection 生命周期，`Session.tsx` 仍混合 route、approval/recovery presentation 与交互 dispatch，`InputBar` 仍集中 Editor、mention、command、keyboard、mode/model、compact、navigation、shutdown 与 StatusBar 等职责。P0 Runtime Activity 曾暴露 Session-root 高频刷新会扩大 OpenTUI native reconciliation 的问题，直接 timer 已下沉修复，但职责集中问题本身仍存在。ADR-0028 已将 **UI Architecture Foundation** 设为 Inspector 之前的强制下一阶段：通过非 React `SessionController`、per-Session disposable UI Store、selector subscription、Composer decomposition、CommandIntent/Interaction Router 与显式 SessionWorkspace surfaces 整改 UI state architecture；该规划阶段不改变 Harness/Runtime/Session authority。

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
- `/tree` / `/jump` / `/parent` / `/root`
- `/compact`
- `/providers`
- `/settings`
- `/theme`
- `/exit`

其中 Session、Provider、Model、Context navigation/compaction、设置、主题和退出均属于本地 CLI 能力；云账户相关 `/login`、`/logout`、`/upgrade`、`/usage` 不再是本地 CLI 命令。

### 5.3 本地会话管理

Stage 6.5 由 `packages/session-store` 和 CLI `LocalSessionAuthority` 提供本地语义会话能力：

| 操作 | 功能 |
| --- | --- |
| `create` | 事务创建带 `session_start` 根 Entry 的本地 Session |
| `list` | 返回未归档的本地 Session 摘要 |
| `load/open` | 加载完整 Session Tree、metadata 和 active cursor |
| `commit` | 原子追加/更新语义 Entries，校验 topology、sequence 和幂等性 |
| `archive` | 本地归档 Session，使其不再出现在默认列表 |

Session 必须先在本地提交成功，CLI 才会导航到它或开始 Provider/Tool 副作用。旧 Server `/sessions` API 及 whole-tree snapshot 上传已从本地 CLI 路径移除；Server/database 仅作为暂停中的未来云代码保留。

### 5.4 本地 Agent / Model 执行

模型调用由 CLI 的 `LocalModelTransport` 直接发起。每个 Model Step 先把当前消息映射成 Harness `ContextRecord`，由 `ContextManager` 按输入预算生成 `ContextProjection`，再将投影结果转换为 ModelMessage 并调用 AI SDK `streamText()`；Harness 根据返回的 Tool Call 在当前 Turn 内执行 Tool Steps，并在工具链结束后决定启动 `steering`、`tool-continuation`、`follow-up` Turn，或结束 Run。

Provider 请求、Context 编译、Tool 执行和 Session semantic commit 均在本地完成；云同步当前未启用，因此不会有云端故障进入 Agent Run 的关键路径。

### 5.5 流式中断与恢复

CLI 通过 Escape 请求中断当前 Run；Model Step 可立即 abort，本地 Tool Step 由 Tool Runtime 传播同一个 AbortSignal。Bash executor 使用受监控的进程组，取消时会终止后代进程并等待命令组退出，避免 Tool 已返回但孙进程仍持有 workspace。Harness 依次追加对应 step/turn/run terminal execution events，并由事件 replay 得到中断状态。`run_end` lifecycle listeners 属于 settlement barrier，因此 Run projection 可能已 terminal，但 `isBusy` 会一直保持到 listeners 完成，`waitForIdle()` 才返回。

Run 活跃期间，普通 Enter 将输入排入 steering queue；Alt+Enter 排入 follow-up queue。steering 在当前 Turn 完成后优先于自动 tool continuation，follow-up 只在 Run 原本将进入 idle 时消费。Session 恢复默认使用 `~/.more-more-code/sessions/sessions.db` 中的本地 Session Tree；本地执行恢复使用 `~/.more-more-code/runtime/runtime.db` 中的 session-scoped Runtime Event/Snapshot。CLI 通过 LocalSessionStore 在 Model/Tool/automatic compaction 副作用前执行 durable-first commit，再由 `RuntimeSession` 执行 awaited write-ahead append；重启时恢复两个 store、预热 Projection Cache，并把未完成 Run/操作报告给 UI，但不会自动重复外部调用。Cloud revision/conflict sync 尚未启用，Stage 6.6 暂停。

### 5.6 多模型抽象

Stage 6.4 已完成多模型抽象迁移。shared 中的固定模型目录现在只承担推荐默认值、价格和 Context metadata，不再是 runtime allowlist；canonical 选择值为 `{ providerId, modelId }`。用户级 `~/.more-more-code/providers.json` 保存严格版本化、非敏感的 Provider Registry，`ProviderId` 与 `ProviderKind` 分离，因此可以同时存在多个 Custom OpenAI-compatible endpoint。

内置 ProviderKind 固定为 OpenAI、Anthropic、Google、DeepSeek，Mistral 已移除。CLI resolver 通过 Registry/Auth seam 创建对应 AI SDK model：OpenAI 使用 Responses、Anthropic/DeepSeek 使用原生 SDK provider、Google 使用 Gemini OpenAI-compatible endpoint，Custom V1 使用可配置 OpenAI-compatible `baseURL`。API Key/Bearer 由独立 CredentialStore 获取；当前是 AES-256-GCM 本地加密适配器 + 环境变量只读兼容 fallback。`/providers` 还提供 secret-safe connection test 和最终请求 URL 预览，测试通过注入 transport 验证配置、凭据、协议、HTTP、模型错误。Codex OAuth 只保留 capability-gated seam，在没有受支持 provider-execution contract 时明确 unavailable 并从 UI 隐藏，不读取 `~/.codex` 私有 token 文件；本轮不声称真实 Provider E2E 或 Codex OAuth 执行已实现。

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
  → LocalSessionAuthority.create 创建并提交本地 session_start
  → LocalSessionAuthority.commit 提交 user_message
  → 跳转本地 /sessions/:id
  → CLI 创建 Run / initial Turn execution events
  → ExecutionEventStore / Projection 建立当前 Run 状态
  → LocalModelTransport 直接调用模型 Provider
  → Tool Call 时由 CLI 在当前 Turn 内执行 Tool Steps
  → Turn End 后按 steering → tool-continuation → follow-up 的规则决定下一 Turn
  → 无待处理工作时 Run End
  → completed Run 追加 Session Tree child node
  → LocalSessionStore 原子提交语义 Entry、active cursor 和 metadata
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
  → LocalSessionStore 原子提交本地 Session Tree 变化
```

### 6.3 错误处理

- Local Session 输入/topology/幂等冲突：由 Store 返回明确的本地错误，拒绝提交；
- 本地 Session commit 失败：在 Provider/Tool 副作用前 fail-closed，不暴露未提交树；
- 模型生成错误：追加本地 `ERROR` Entry，并通过 CLI UI/生命周期反馈；
- Provider connection test：区分配置、凭据、协议、HTTP、网络和模型错误，诊断不包含密钥或完整 provider error body；
- Runtime/Context/Tool 基础设施错误：保持 durable-first/awaited write-ahead 约束，并向 CLI 报告，不静默转成可继续副作用的普通结果。

## 7. 配置与运行依赖

项目运行至少依赖：

- Bun；
- SQLite（本地 Session Store + Runtime Store，无独立服务进程）；
- 已配置的 Provider Registry；需要认证的 Provider 还需 CredentialStore/API Key（Custom `None` 可无需凭据）；
- 可选的 `LOCAL_SESSION_STORE_DATABASE_URL` / `RUNTIME_STORE_DATABASE_URL`（必须是绝对 `file:` URL）。

本地 CLI 不读取 `API_URL`，也不要求 Server、Clerk、Cloudflare、Railway 或 `DATABASE_URL`。Local Session Store 默认写入 `~/.more-more-code/sessions/sessions.db`；Runtime Store 默认写入 `~/.more-more-code/runtime/runtime.db`。Server/database 仍可能因维护未来云代码需要独立的 PostgreSQL 配置，但不属于本地 CLI 启动/运行依赖；云端与本地 Prisma Client 仍保持独立生成路径。

## 8. 当前实现边界与值得关注的问题

以下内容是基于当前代码确认的主要边界：

1. **Provider Runtime 已完成本地配置化，但 OS-native Secret Store 仍可加强**
   Stage 6.4 已交付用户全局 Provider Registry、`ProviderId`/`ProviderKind`、动态 `ModelRef`、CredentialStore/Auth Strategy 与 `/providers`/动态 `/models`。当前 CredentialStore 的 AES-256-GCM 本地文件适配器解决明文 JSON/序列化泄漏，但加密 key 与数据都位于用户配置目录，因此不把它描述成等价于 Windows Credential Manager/macOS Keychain/Secret Service 的系统级隔离；后续可在同一接口下替换。

2. **Codex OAuth 目前只有安全 seam/status，尚不是可执行认证方式**
   OpenAI `codex-oauth` 与 API Key 已被建模为不同 Auth Strategy，但当前没有采用复制/解析私有 Codex token 文件的非正式方案。Broker 因此显式返回 unavailable，Provider execution 会 fail early 并要求 API Key；真正登录/登出和 token acquisition 需要后续建立在受支持、可维护的 Codex 集成协议上。

3. **Local Session authority 已交付，云同步被移出当前 CLI**
   `packages/session-store` 在 SQLite 中直接持久化 append-only `entries[]`、root/active cursor、metadata、stable sequence 和 revision；事务会校验 Session Tree topology，并对相同 Entry 做幂等处理。`packages/server` / `packages/database` 不再参与本地 create/list/open/continue/restart。显式导入 legacy linear/v1/v2/v3 快照的事务性/idempotent 命令尚未实现，属于不阻断新本地 Session 的 follow-up。

4. **Durable Runtime Store、有效权限策略、交互式审批与派生安全审计已形成完整应用层安全链**
   Run / Turn / Step 通过 `RuntimeSession` 串行写入并投影本地 SQLite events；snapshot failure 不再把已提交 append 误报为失败。Tool Runtime 使用 Harness 的统一 `allow | deny | ask` contract，把 code defaults、global config 与 project config 合成为 last-match-wins effective policy，并按 command/path/resource/scope 在 executor 前执行；构造 Tool Runtime 必须显式注入 PermissionPolicy 与 ApprovalBroker。所有 capability 先完成评估：任一 deny 直接阻止，多个 ask 聚合为一次 Tool-call approval。CLI 只提供 Allow once / Deny，原始 command/path/resource 只在 process-local approval request 中展示，不写 permission config。Tool/Context/system 使用严格白名单 v1 payload；permission lifecycle 使用 v2，approval lifecycle 使用 v3，均兼容旧 v1 decision。Harness 的 `projectSecurityAuditTimeline` 关联 permission、approval 与 Tool terminal，检测缺失/重复/乱序、metadata mismatch 及 enforcement 冲突。Replay 只验证 lifecycle consistency，不从脱敏事件伪造 policy recomputation；审计历史也不复制进 RuntimeSession snapshot。

5. **Process Sandbox seam 已贯通，但平台级隔离能力仍不对称**
   Tool Runtime 继续统一 timeout/cancellation，而 native `bash` / `grep` 的所有子进程已经收口到独立 `ProcessSandbox`：它验证 writable workspace/cwd、按 `off | auto | required` 选择 provider，并默认使用 safe environment，避免 ambient Provider/API credential 进入子进程。Linux 在可发现 `bwrap` 时可使用 read-only host root + writable workspace、masked home/private temp、PID/IPC/UTS namespace 与可选 network namespace；`required` 或无法满足的 `network=deny` 在 spawn 前 fail-closed。当前 Windows 环境没有原生 AppContainer/restricted-token/Job-object adapter，`auto` 因此只能显式使用 unisolated direct fallback，不能把它描述为完整 OS Sandbox。

6. **Context reduction 已形成 Tool Working Set + Branch Summary + semantic Compaction 三种独立语义，但 tokenizer 仍是显式估算器**
   Tool Result Working Set 先对过大的 warm/cold shell、test/build、search/grep、file-read、generic 输出做 model-facing `truncated/summary/reference` 投影，canonical `tool_result` 不变。Branch Summary 则在跨路径导航确实会丢失 source-only 语义知识时按 `ask | always | never` 做 lazy transfer；Carry 使用独立 bounded reducer（上限 `min(4096, 4% input budget)`），并以 provenance/coverage 去重，No Carry/Cancel 均不制造 Session branch。Active-path Branch Summary 作为 historical Context record 参与普通 Compaction；checkpoint 使用 generic record IDs 防止已吸收知识重复投影。历史 Compaction 仍按 80% soft / 92% hard / 70% target 和完整 group/Turn cut point运行，`/compact` 复用同一 checkpoint pipeline并执行安全 eligibility gate。Harness 同时提供 exact tokenizer adapter 接口，但当前模型家族仍使用明确标记为 `estimated` 的计数器。

7. **本地 Session 与 Runtime 已形成独立 durable authority**
   `NewSession`、Session list/open/continue、branch、Context checkpoint/cache 和 restart recovery 均使用本地 Session/Runtime Store；提交失败会在 Provider/Tool 副作用前 fail-closed。云端 sync/backup 尚未启用，Stage 6.6 已暂停，恢复前需要显式产品重新批准。

8. **Server/database 目前仅为 dormant future cloud 保留**
   ADR-0024 暂时禁用云账户、Session API 和 Railway；Server/database 不进入本地 CLI startup、Session lifecycle、Provider credentials、Model Step、AgentLoop、Tool、Context、Runtime Event 或 Sandbox 路径。未来若重新启用，只能通过重新批准的 Stage 6.6 sync/backup 与商业 Entitlement 边界进入，并且不能成为每次 Model Step 的关键路径。

9. **本地 Stage 6.5 覆盖已补齐，外部端到端仍有明确边界**
   已有 Local Session Store migrations/transaction/topology/idempotency、离线 create/list/open/restart/continue、durable-first user/model/tool/automatic-compaction、Provider connection/default persistence、AgentLoop、ExecutionEventStore/Projection、Runtime Store migration/restart、write-ahead/redaction/recovery、LocalModelTransport Context lifecycle、Tool Runtime 和 Session Tree 回归测试。本轮不声称真实外部 Provider E2E、Codex OAuth execution、Cloud Session Sync 或完整 CLI 键盘/节点跳转 UI 集成测试已完成。

   Stage 6.5 交付后发现的 AI SDK runtime-message 与严格 Session JSON persistence 兼容性缺口已按 ADR-0025 完成修复：CLI 在 runtime Message -> Session semantic history 边界使用统一 Durable Message Normalization seam；Store 继续 strict/fail-closed，合法 JSON Provider metadata 保留，对象 `undefined` 规范化为字段缺失，数组 `undefined`/hole 规范化为 `null`。随后 ADR-0026 又完成 finalized-message / semantic navigation follow-up：新 normal assistant history 按 AgentLoop Model Step append，不再写 Tool-terminal `message_update`；legacy update 只读兼容；`/tree` 使用 semantic Navigation Projection 与 derived ToolUse。

   真实 CLI Tool conversation 进一步暴露了 finalized identity 缺口：AI SDK v7 会在 Tool continuation 中复用同一个 assistant `UIMessage.id`。初版若把该 ID 当 durable message identity，就会在后续 Model Step 抛出 `already exists with different content`。当前实现已将 durable assistant identity 改为 `stepId`，并按最新 `step-start` 切出当前 Model Step；fake Provider 回归证明两步共用一个 UIMessage ID 后再 follow-up，模型输入仍只有一组匹配 Tool Call/Result，且 continuation 文本不丢失。

10. **可观测性配置偏开发态**
    Sentry DSN 仍直接写在代码中，Trace 采样率较高，并保留测试异常路由，上线前应环境化。

## 9. 项目现阶段总结

项目现在的核心性质已经从“Client + 远程 AI Chat Server”转为“**Local Coding Agent + Local Session/Provider Authority**”。CLI 是 authoritative execution 与 semantic Session runtime；Cloudflare/Railway 和云账户路径已退出当前本地产品，Server/database 仅作为 Stage 6.6 重新批准后可能启用的 dormant future cloud 边界。

本分析记录的是已实现架构与最终集成证据。Stage 6.5 先修复了默认 Session ID 生成器的 Bun `Crypto` receiver 问题，随后通过 ADR-0025 交付 Durable Message Normalization，再通过 ADR-0026 交付 Finalized Message Persistence、Tool terminal Message Projection 与 semantic `/tree`。ADR-0026 最终验证期间又修复了 AI SDK Tool continuation 复用 assistant `UIMessage.id` 导致 durable finalization identity 冲突的问题。当前最终证据为 CLI **171/171**、Local Session Store **11/11**、Harness **99/99**；CLI/Session Store typecheck、CLI build 与 `git diff --check` 全部通过。真实 DeepSeek conversation 是该 reused-ID bug 的发现来源，但自动 delivery gate 使用确定性的 AI SDK/fake Provider 回归，不声称真实外部 Provider E2E 已纳入套件。

现阶段最核心的已完成能力是：

- 显式 AgentLoop、append-only Execution Events 与 Run / Turn / Step projection；
- pi-style Run/Turn/Step lifecycle，Turn = Model response + requested Tools；
- awaited lifecycle stream、`waitForIdle()` 与 settlement-aware `isBusy`；
- Turn-safe steering / follow-up queue；
- CLI 本地 Model Step 与 Tool Step；
- 终端流式交互和中断；
- Local Session Store 的 SQLite Session Entry Tree v3 authority、事务/迁移/幂等提交与归档；
- 无 Server/API URL 的本地 create/list/open/continue/restart/branch，以及 durable-first user/model/tool/automatic-compaction transitions；
- Session Entry Tree v3、任意 Entry 投影、lazy navigation 与 coverage-aware Branch Summary knowledge transfer；
- Harness ContextManager、ModelContextProfile、Turn-aware token budget、retained tail、Tool Result Working Set 与 automatic/manual semantic Compaction；
- 多 Provider 的本地抽象、`/providers` secret-safe connection test 与 `/models` 默认选择持久化；
- 默认启用的本地 SQLite Runtime Store、严格脱敏 Runtime Event、snapshot-plus-replay recovery 与未完成工作提示；
- Harness 统一 permission policy、global/project persisted overrides、Tool Runtime capability enforcement 与脱敏 permission lifecycle；
- Tool-call-level Interactive Approval Broker、Allow once / Deny CLI 审批、same-Step resume、approval cancel/timeout 与脱敏 schema-v3 approval lifecycle；
- 派生 security audit timeline、v1/v2/v3 lifecycle consistency replay 与 dangerous-operation enforcement validation；
- ProcessSandbox 深模块、strict sandbox config、safe child environment、Linux Bubblewrap launch plan，以及 `bash/grep` 统一 subprocess seam；
- AgentLoop / lifecycle interaction / ExecutionEventStore / Execution Projection / ContextManager / Session Tree 确定性测试基础。

Stage 6.2 已补齐原先 `ask -> approval_required` 的产品死路；Stage 6.3 又把 process creation 收口到可替换的 Sandbox seam，并在 Linux/Bubblewrap 上提供真实的 workspace-write/process/network 隔离能力；Stage 6.4 完成 Provider Runtime、Credential/Auth seam、动态 ModelRef 与 Provider 管理 UX；Stage 6.5 完成本地 Session authority 与 Railway retirement。当前 Stage 6.6 Cloud Session Sync & Commercial Entitlements 暂停，Stage 6.7 Windows Native Sandbox 仍是后续工作。显式 legacy import、MCP transport/auth/remote Tool trust boundary、持久化 allow-for-session/project、shell-AST-aware authorization、exact tokenizer 与 OS-native Secret Store 继续独立演进。
