# More More Code 项目核心分析

> 本文基于当前仓库代码整理，重点覆盖项目架构、核心数据结构、已实现功能、关键流程及当前边界，不展开逐文件说明。

## 1. 项目定位

More More Code 是一个 local-first 的终端 Coding Agent 原型。CLI 是真正的应用与 Agent Runtime：负责 TUI、Harness、模型调用、Tool Loop、本地工作区操作和消息编排；Hono Server 不参与模型执行，只承担云端 Session 持久化、恢复数据和必要的账户服务。

项目当前的核心闭环为：

1. 用户在终端输入消息；
2. CLI 创建 Harness Run / Turn，并执行本地 Model Step；
3. 模型产生 Tool Call 时，CLI 在本地执行 Tool Step；
4. Harness 持续驱动 Model ↔ Tool Loop，CLI 实时渲染模型流；
5. UIMessage 会话快照通过 Session Store 同步到 Server / PostgreSQL；
6. 再次进入会话时，从云端快照恢复消息历史后继续由本地 Runtime 执行。

## 2. 技术栈与仓库结构

项目采用 Bun Workspaces 管理，根目录通过 `packages/*` 组织五个内部包。

| 包 | 主要技术 | 职责 |
| --- | --- | --- |
| `packages/cli` | React 19、OpenTUI、AI SDK、Provider SDK、Hono RPC Client | 本地应用层：UI、模型调用、消息编排、本地工具执行、云会话同步 |
| `packages/harness` | TypeScript | Agent Loop、Run / Turn / Step 生命周期、执行状态机 |
| `packages/server` | Bun、Hono、Sentry | 云服务层：会话持久化、会话恢复数据、认证及外围账户 API |
| `packages/database` | Prisma 7、PostgreSQL、`@prisma/adapter-pg` | 数据模型、Prisma Client、数据库连接 |
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
  │  Run → Turn → Step(model/tool)
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

Harness 包位于 CLI 的执行路径中，负责显式驱动 Model Step 与本地 Tool Step 的循环。模型 Provider、System Prompt 与 `streamText()` 同样位于 CLI；Server 不参与 Agent Run，只接收会话快照用于云端恢复。共享包统一模型 ID 与工具契约，数据库包统一导出 Prisma Client。

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

模型调用由 CLI 的 `LocalModelTransport` 直接发起。每个 Model Step 先把当前消息映射成 Harness `ContextRecord`，由 `ContextManager` 按输入预算生成 `ContextProjection`，再将投影结果转换为 ModelMessage 并调用 AI SDK `streamText()`；Harness 根据返回的 Tool Call 决定是否进入本地 Tool Step 以及是否继续下一次 Model Step。

Server 只通过 Session Store 接收会话树状态快照，因此云同步失败和 Agent Run 失败属于两个不同的故障域。

### 5.5 流式中断与恢复

CLI 直接中断本地 Model Step，并由 Harness 将当前 Run / Turn / Step 标记为 `interrupted`。云端恢复目前基于 versioned Session Tree snapshot，而不是重连 Server 上的模型流。每个树节点都是可恢复点，`activeNodeId` 决定当前 continuation cursor。

更完整的 Run/Turn/Step Event Store、离线本地 WAL、精确 tokenizer 和 compaction 仍属于后续 Context/Session Runtime 阶段。

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
  → CLI 创建 Run / Turn
  → LocalModelTransport 直接调用模型 Provider
  → Tool Call 时由 CLI 本地执行 Tool Step
  → Harness 持续 Model ↔ Tool Loop
  → Run 完成后追加 Session Tree child node
  → versioned Session Tree state 同步到 Server
```

### 6.2 会话内继续提问

```text
用户提交文本
  → CLI 创建新的 Run / Turn
  → 本地 Model Step 流式更新 UI
  → 本地 Tool Step 执行工作区操作
  → Harness 决定是否继续下一 Model Step
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
- PostgreSQL；
- `DATABASE_URL`；
- 所选模型 Provider 对应的 API Key；
- 可选的 `API_URL`。

数据库代码在缺少 `DATABASE_URL` 时会在模块加载阶段直接抛错。Prisma Client 输出到 `packages/database/generated/prisma`，可通过数据库包的 `db:generate` 脚本重新生成。

## 8. 当前实现边界与值得关注的问题

以下内容是基于当前代码确认的主要边界：

1. **Provider 依赖刚从 Server 迁到 CLI**
   `packages/cli/package.json` 已声明 Provider SDK，但当前工作区需要重新执行一次 `bun install` 才会重建 workspace node_modules 链接。

2. **模型清单与实际 Provider 支持仍不完全一致**
   当前本地 resolver 实现 OpenAI、Anthropic 和 DeepSeek；其他模型应在清单或 resolver 层统一处理。

3. **云 Session 目前仍是快照同步**
   当前 CLI 使用 `POST /sessions/:id/state` 最后写入完整 Session Tree snapshot，没有 revision / optimistic concurrency / conflict resolution；旧 `/messages` 仅保留兼容。

4. **Run / Turn / Step 仍是内存 Runtime 状态**
   云端已经可以恢复会话树节点与 active cursor，但仍不恢复精确执行到哪一个 Harness Step；完整事件恢复属于后续 Event Store。

5. **Tool Step 的主动取消尚未完善**
   Model Step 可以被 abort，Harness 也会停止后续 Step，但已启动的本地 shell/tool 还需要 Tool Runtime 级 cancellation。

6. **Context Manager 已加入 v1，但仍是近似预算**
   当前已经在模型调用前执行 Harness Context Projection，并保留 required tail；token 估算仍是字符数近似，模型特定 tokenizer/profile 与 compaction 尚未加入。

7. **云同步暂时是 best-effort**
   同步失败不会让本地 Agent Run 失败，这是正确的故障域隔离；但目前只有日志，没有 retry queue、本地 WAL 或离线 Session Store。

8. **Server 仍保留 auth / billing 外围路由**
   它们不参与 Agent Runtime。如果最终要求 Server 严格只做 Session Storage，可进一步把 billing 拆为独立账户服务。

9. **测试覆盖仍需扩展**
   已有 AgentLoop、ContextManager、Session Tree 和聊天提交回归测试，但还缺 LocalModelTransport、真实 Cloud Session Sync、节点跳转 UI 与真实多轮 Tool Loop 的集成测试。

10. **可观测性配置偏开发态**
    Sentry DSN 仍直接写在代码中，Trace 采样率较高，并保留测试异常路由，上线前应环境化。

## 9. 项目现阶段总结

项目现在的核心性质已经从“Client + 远程 AI Chat Server”转为“**Local Coding Agent Runtime + Cloud Session Store**”。CLI 是 authoritative execution runtime；Server 只是云数据边界，不参与 Run / Turn / Step 的推进。

现阶段最核心的已完成能力是：

- 显式 AgentLoop 与 Run / Turn / Step 生命周期；
- CLI 本地 Model Step 与 Tool Step；
- 终端流式交互和中断；
- 云端 Session 创建、读取和 versioned Session Tree snapshot 同步；
- 任意 Session Tree 节点跳转与从历史节点自然分叉；
- Harness ContextManager 与基础 token budget projection；
- 多 Provider 的本地抽象；
- AgentLoop / ContextManager / Session Tree 确定性测试基础。

下一阶段应优先建立 Canonical Event History / Event Store、精确 model profile/tokenizer 与 compaction，然后再进入 Tool Registry、Permission、Sandbox 和基于 Session Tree 的 Subagent。
