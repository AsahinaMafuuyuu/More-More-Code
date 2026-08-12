# MORE-MORE-CODE 当前实现与近期代码抉择

> 日期：2026-08-12  
> 用途：记录当前工程已经实现的核心能力、最近一次 Harness/会话架构整改、关键边界和后续开发约束，供后续开发者与 Agent 快速恢复上下文。

---

## 1. 当前项目定位

MORE-MORE-CODE 当前已经从普通的“CLI 调 Server、Server 再调用模型”的聊天应用，调整为 **Local-first Coding Agent** 架构。

核心原则：

- **CLI 是真正的应用层和 Agent Runtime**；
- **Harness 在本地拥有 Agent Loop 的执行控制权**；
- **模型调用直接由 CLI 发往 Provider API**；
- **文件系统、Shell 等工具全部在 CLI 本地执行**；
- **Server 不参与 Agent 执行，只承担云端会话数据存储/恢复等外围能力**；
- 云端 Session 同步失败不应直接导致本地 Agent Run 失败。

当前主链路：

```text
User
  ↓
OpenTUI / React CLI
  ↓
AgentLoop
  ↓
┌────────────────────────────────────────────┐
│ Model Step                                 │
│ CLI → LocalModelTransport → LLM Provider   │
└────────────────────────────────────────────┘
  ↓
模型是否请求 Tool？
  ├─ No  → Turn / Run 完成
  └─ Yes
       ↓
     Tool Step
       ↓
     CLI Local Tools
       ↓
     Tool Output
       ↓
     下一次 Model Step

与此同时：
CLI Message Snapshot
  ↓
Session Store
  ↓
Cloud Server
  ↓
PostgreSQL
```

---

## 2. 已实现：独立 Harness Runtime

新增独立工作区包：

```text
packages/harness/
├── src/
│   ├── agent-loop.ts
│   ├── types.ts
│   └── index.ts
└── tests/
    └── agent-loop.test.ts
```

### 2.1 Run / Turn / Step 生命周期

已经明确区分三个层级：

#### Run

一次顶层 Agent 执行。

当前通常由一次用户 submit 创建一个 Run。

主要字段包括：

- `id`
- `sessionId`
- `status`
- `startedAt`
- `endedAt`
- `error`
- `turns[]`

#### Turn

Run 内的一次用户交互单元。

当前一个顶层 Run 通常只有一个 Turn，但结构上保留了：

```text
Run
└── Turn[]
```

以便未来支持：

- 多 Turn runtime；
- Subagent；
- Approval；
- Session Tree；
- 更复杂的交互状态。

Turn 当前包含：

- `id`
- `runId`
- `index`
- `inputMessageId`
- `status`
- `steps[]`

#### Step

Agent Runtime 最小执行单元。

当前有两种：

```text
model

tool
```

Model Step：

```text
CLI → LLM Provider
```

Tool Step：

```text
CLI → 本地 Tool Runtime
```

Tool Step 还记录：

- `toolCallId`
- `toolName`

### 2.2 生命周期状态

Run / Turn / Step 当前统一支持：

```text
running
completed
interrupted
failed
```

同时记录开始时间、结束时间及错误信息。

---

## 3. 已实现：显式 Agent Loop

Agent Loop 不再依赖 AI SDK 的自动 Tool Resubmit 行为。

当前逻辑为：

```text
Run
└── Turn
    ├── Model Step
    │    ↓
    │  tool calls?
    │
    ├── Tool Step
    ├── Tool Step
    │
    ├── Model Step
    │
    └── ...直到模型不再产生 tool call
```

核心循环：

```text
model
  ↓
tool calls
  ↓
tool execution
  ↓
tool output
  ↓
model
  ↓
...
```

当前 AgentLoop 已实现：

- Model Step / Tool Step 显式编排；
- 单次 Run 防并发执行；
- `AgentLoopBusyError`；
- 最大 Step 数保护；
- 默认 `maxSteps = 64`；
- Run/Turn/Step 状态变化通知；
- Model Step 中断；
- Step 错误 → Run failed；
- Run 快照复制，避免外部直接修改内部状态。

---

## 4. 已实现：Agent Loop 中断机制

当前中断流程：

```text
User ESC / interrupt
   ↓
AgentLoop.interrupt()
   ↓
interruptRequested = true
   ↓
abortModelStep()
   ↓
AI SDK chat.stop()
   ↓
Model Step interrupted
   ↓
Turn interrupted
   ↓
Run interrupted
```

CLI UI 当前已经以 **Run lifecycle** 为主要执行状态，而不是只依赖 AI SDK 的 `streaming/submitted` 状态。

因此在 Tool Step 和 Model Step 之间，UI 不会错误地认为 Agent 已经空闲并允许再次提交。

### 当前限制

正在执行中的本地 Tool 还没有真正的 AbortSignal 级取消能力。

当前行为是：

- Model Step 可以立即 abort；
- Tool Step 执行期间收到 interrupt 后，会在 Tool Step 返回后停止后续 Step。

未来应该由独立 Tool Runtime 支持 Tool-level cancellation。

---

## 5. 已实现：CLI 本地 Model Runtime

模型执行已经从 Server 移到 CLI。

核心文件：

```text
packages/cli/src/lib/local-model-transport.ts
packages/cli/src/lib/models.ts
packages/cli/src/lib/system-prompt.ts
```

### 5.1 LocalModelTransport

`LocalModelTransport` 实现 AI SDK 的 `ChatTransport<Message>`。

它在 CLI 进程中完成：

1. 解析当前 `mode` / `model`；
2. 获取当前模式可用工具；
3. 校验 UI Messages；
4. `convertToModelMessages()`；
5. 解析具体 Provider Model；
6. 调用 `streamText()`；
7. 转换成 AI SDK UI Message Stream；
8. 回传 reasoning/text/tool-call 等流式结果；
9. 记录模型耗时和 token usage；
10. 发出 Message Snapshot。

它**不会调用 Server `/chat`**。

### 5.2 当前 Provider

CLI 已直接接入：

- OpenAI；
- Anthropic；
- DeepSeek。

当前 DeepSeek 部分模型配置开启：

```text
thinking.enabled
reasoningEffort = medium
```

Provider API Key 因此需要存在于 CLI 本地运行环境中。

### 5.3 System Prompt

System Prompt 也已经迁移到 CLI。

Server 不再负责 Prompt 组装。

当前 Prompt 会根据模式区分：

```text
PLAN
BUILD
```

并给模型描述可用工具和行为限制。

---

## 6. 已实现：本地 Tool Runtime

本地工具由：

```text
packages/cli/src/lib/local-tools.ts
```

执行。

当前已经实现：

### Read-only tools

```text
readFile
listDirectory
glob
grep
```

### Write / execution tools

```text
writeFile
editFile
bash
```

### PLAN / BUILD 模式限制

PLAN 模式只允许：

```text
readFile
listDirectory
glob
grep
```

BUILD 模式允许读写与 Shell 执行。

### 文件路径保护

文件型工具通过：

```text
resolveInsideCwd()
```

限制目标路径必须位于当前项目目录中。

如果路径逃逸：

```text
../
absolute outside path
```

会直接拒绝。

### 输出限制

当前已经对部分 Tool 输出设置截断限制，例如：

- 文件读取大小限制；
- glob 最大返回数量；
- grep 最大匹配数量；
- bash stdout/stderr 最大长度；
- bash 默认超时。

### 当前安全限制

`bash` 目前虽然以项目目录作为启动 cwd，但仍然是普通 Shell：

```text
Bun.spawn(["bash", "-c", command])
```

它不等于真正的 Sandbox。

Shell 命令理论上仍可主动访问 cwd 外路径。

因此当前：

> 文件工具存在路径边界，但 Bash 尚未实现真正的 permission/sandbox isolation。

这是后续 Harness 安全层的重要工作。

---

## 7. 已实现：CLI Chat Adapter 与 AI SDK UI 状态桥接

核心文件：

```text
packages/cli/src/hooks/use-chat.ts
```

当前职责为：

```text
React UI
  ↓
AI SDK useChat
  ↓
LocalModelTransport
  ↓
AgentLoop Adapter
  ↓
Local Tools
```

### 已处理的重要问题

此前曾错误使用：

```ts
sendMessage({ messageId: newId })
```

AI SDK 中 `messageId` 代表“替换已有 user message”，而不是给新消息设置 ID。

现已改为构造完整的新 UIMessage：

```text
id
role = user
parts
metadata
```

从而保证：

```text
Turn.inputMessageId
```

能够稳定关联对应用户消息。

Tool 执行完成后的 continuation 使用：

```ts
chat.sendMessage()
```

表示：

> 不创建新的 User Message，以当前 Message State 继续下一次 Model Step。

---

## 8. 已实现：Server 退出 Agent Runtime

这是最近最重要的架构调整。

### 旧架构

```text
CLI
 ↓
Harness
 ↓
Server /chat
 ↓
LLM
```

虽然 Agent Loop 在 CLI，但 Model Step 仍然依赖 Server。

该架构已经废弃。

### 当前架构

```text
CLI
├── UI
├── Harness
├── AgentLoop
├── Model Runtime
├── Provider
├── Tools
└── Session Sync

Server
└── Cloud Session Persistence
```

Server 当前主路由：

```text
/sessions
/auth
/billing
```

Server **不再挂载 `/chat`**。

以下能力也不再属于 Server Agent 执行链路：

```text
streamText
Model Resolver
System Prompt
LLM Provider SDK
Agent Loop
Tool Runtime
```

---

## 9. 已实现：Cloud Session Persistence

Server 当前主要用于：

- Session 创建；
- Session 列表；
- Session 查询；
- Versioned Session Tree Snapshot 保存；
- 登录用户隔离；
- 后续会话恢复。

当前接口统一遵循项目约定：

> HTTP API 只使用 GET 和 POST。

当前 Session API：

```text
GET  /sessions
GET  /sessions/:id
POST /sessions
POST /sessions/:id/state
POST /sessions/:id/messages   # legacy compatibility
```

不使用：

```text
PUT
PATCH
DELETE
```

### 会话树持久化

CLI 通过：

```text
packages/cli/src/lib/session-store.ts
```

将当前 versioned Session Tree Snapshot 发送到：

```text
POST /sessions/:id/state
```

Server 当前仍复用 Prisma `Session.messages` JSON 字段保存树状态，因此这一阶段不需要数据库 migration。旧版线性 messages array 和 `POST /sessions/:id/messages` 继续作为兼容格式存在。

### 故障域设计

Cloud persistence 与 Agent execution 解耦。

当前设计：

```text
Session Sync failed
        ↓
记录 console error
        ↓
Agent Run 继续执行
```

即：

> Server 暂时不可用，不应导致本地 Model/Tool Loop 直接失败。

---

## 10. 当前数据库模型

Session 当前核心结构仍然较简单：

```text
Session
├── id
├── userId
├── title
├── createdAt
├── updatedAt
└── messages: Json
```

目前 Server 保存的是 versioned Session Tree Snapshot，而不是 Run/Turn/Step Event Store。树节点内部第一版仍保存可恢复的 UI Message payload snapshot。

这一点需要和未来 Canonical Event History / Event Store 区分。

---

## 11. 当前 UI Runtime 行为

Session UI 已开始以 Agent Run 作为主要状态边界。

Run 处于：

```text
running
```

时：

- 输入框禁用；
- loading 显示；
- ESC 可以触发 interrupt；
- 不允许因为 Model Stream 短暂结束而误提交新的 Turn。

同时：

- AI SDK transport error 会显示；
- Harness Run failure 也会显示。

---

## 12. 已实现测试

### Harness tests

当前覆盖：

1. 普通 Run 正常完成；
2. `model → tool → tool → model`；
3. Model Step interrupt；
4. Tool Step 集成失败；
5. `maxSteps` 防无限 Loop；
6. Context budget 优先保留最新历史；
7. required context 超预算行为；
8. Session Tree root / append；
9. 从祖先节点跳转后形成 sibling branch；
10. legacy messages array 恢复为树。

当前验证结果：

```text
10 pass
0 fail
```

### CLI chat regression tests

当前覆盖：

1. 新 user message 可以由 Harness 指定 ID；
2. Tool 后可以 continuation，不创建第二条 User Message。

当前验证结果：

```text
2 pass
0 fail
```

### 构建

2026-08-12 当前验证：

```text
All tests      12 PASS / 0 FAIL
Harness type   PASS
CLI typecheck  PASS
Server typecheck PASS
CLI build      PASS
Server build   PASS
```

---

## 13. 已完成的 Monorepo 调整

当前主要工作区：

```text
packages/
├── cli/
├── harness/
├── server/
├── database/
└── shared/
```

其中：

### cli

真正的本地应用层：

- TUI；
- Chat UI state；
- AgentLoop Adapter；
- Model Runtime；
- Local Tools；
- Session Sync。

### harness

纯 Agent Runtime Core：

- Run；
- Turn；
- Step；
- Agent Loop；
- interruption；
- max step protection。

Harness 不依赖 React/Server/Provider 具体实现。

### server

Cloud service：

- Auth；
- Session persistence；
- Billing peripheral API；
- Database access；
- Sentry。

### shared

共享：

- Model definitions；
- Tool contracts；
- Schemas；
- 通用类型。

---

## 14. 已更新 `.gitignore`

当前原则：

> 对构建、运行、测试、部署、协作和长期维护没有工程价值的本地文件，不进入 Git。

当前主要忽略：

```text
node_modules/
dist/
out/
coverage/
.env
.env.*
.claude/
.codex/
.agents/
.wrangler/
*.log
*.tmp
*.bak
Prisma generated client
一次性 Agent task plan/todo
```

明确保留：

```text
README.md
PROJECT_ANALYSIS.md
docs/decisions/
packages/*/tests/
packages/harness/
bun.lock
.env.example
.vscode/settings.json
worker-configuration.d.ts
```

---

## 15. 近期关键代码抉择

### Decision 1：Agent Loop 必须由 CLI/Harness 拥有

原因：

- Coding Agent 操作的是本地 Workspace；
- Tool Runtime 位于本地；
- 中断、权限、Sandbox、Subagent 都天然属于本地执行环境；
- 不应该依赖 Server 才能运行一次 Agent Step。

### Decision 2：Server 不是 Agent Backend

Server 定位：

```text
Cloud Session Store
```

不是：

```text
Agent Runtime Server
LLM Gateway
Tool Coordinator
```

### Decision 3：Model Provider 调用属于 CLI

当前：

```text
CLI → Provider
```

而不是：

```text
CLI → Server → Provider
```

### Decision 4：Cloud Sync 不能成为 Agent Loop 的硬依赖

Agent 执行和 Session 云同步必须分离故障域。

### Decision 5：Run / Turn / Step 是 Harness 基础语义

后续 Context、Event Store、Subagent 等都应该基于这套生命周期继续扩展，而不是重新设计另一套执行层级。

### Decision 6：Server API 统一 GET + POST

读取：

```text
GET
```

写入/Command：

```text
POST
```

当前项目不使用 PUT / PATCH / DELETE。

---

## 16. 当前 Harness 第二阶段状态与未实现能力

当前已经从单纯 Agent Loop 第一阶段进入 Context / Session Runtime 第二阶段。

### 16.1 Context Manager：已完成 v1

`packages/harness/src/context.ts` 已新增与 React / AI SDK 解耦的通用 `ContextManager`：

- 输入为 `ContextRecord<TPayload>[]`；
- 输出为不可变 `ContextProjection`；
- 支持 required records；
- 超出预算时优先保留较新的可选历史；
- 不修改、不压缩原始 History；
- 显式返回 `truncated` / `overBudget`。

CLI `LocalModelTransport` 当前先把经过校验的 UI Messages 映射为 Context Records，再完成 Context Projection，最后才转换为 Provider `ModelMessage`。

当前仍未完成：

- System / project instructions 统一纳入 canonical context record；
- selected files / project memory；
- provider tokenizer 精确计数；
- 真正独立于 UIMessage payload 的 Event/History Store。

### 16.2 Token Budget：已完成基础预算层

当前已经存在：

```text
context window
- reserved output
- safety margin
- system prompt estimate
= safe input budget
```

第一版使用保守的字符数近似 token estimator，并保留最近 2 条消息作为 required tail。

当前尚未完成真正的 model-specific profile / tokenizer，因此这仍是 Harness 预算机制的基础版本，而不是最终模型精确预算实现。

### 16.3 Compaction

尚未实现：

- history compression；
- split-turn compaction；
- retained tail；
- tool/file history summary。

### 16.4 Persistent Run / Turn / Step Event Store

当前 Run/Turn/Step 只存在内存。

数据库保存的是 versioned Session Tree Snapshot；Run / Turn / Step event 仍未持久化。

未来建议明确拆分：

```text
Event History      = 实际发生了什么
Context Projection = 发给模型什么
UI Projection      = 给用户显示什么
Cloud Snapshot     = 用于会话恢复的数据
```

### 16.5 Permission Engine

尚未形成统一：

```text
allow
deny
ask
```

权限决策机制。

### 16.6 Sandbox

当前没有真正的进程 Sandbox。

尤其 `bash` 仍需要：

- workspace filesystem isolation；
- network policy；
- process policy；
- environment filtering；
- privilege boundary。

### 16.7 Tool Registry

当前工具执行仍通过集中 switch 分发。

未来可以演进为：

```text
Tool Registry
├── contract
├── executor
├── permission
├── timeout
├── cancellation
└── telemetry
```

### 16.8 Session Tree：已完成 v1；Subagent 尚未实现

当前已实现版本化 Session Tree：

```text
root
  └─ turn A
      ├─ turn B
      │   └─ turn C
      └─ turn B'
```

每个节点包含：

- stable node id；
- `parentId`；
- `createdAt`；
- 可恢复 messages snapshot；
- 可选 `runId` / `inputMessageId`。

`activeNodeId` 作为当前 continuation cursor。CLI 可以跳转到任意历史节点；从旧节点重新 submit 时会自动创建新的 child branch，不会覆盖原 sibling branch。

当前命令：

```text
/tree    浏览树并跳转任意节点
/jump    打开节点跳转器
/parent  跳转当前节点父节点
/root    跳转根节点
```

Session Tree 通过 `POST /sessions/:id/state` 保存到现有 Session JSON 字段，因此本阶段不要求数据库 migration；旧线性 messages array 会在 CLI 恢复时自动升级成单节点树。

仍未实现：

- Subagent child runtime；
- subagent context projection；
- subagent result projection；
- Event/Delta 形式的树节点去重；
- 多设备 revision / conflict resolution。

---

## 17. 当前需要特别避免的架构回退

后续开发时不要重新引入以下模式：

### 不要让 Server 重新执行 Model Step

错误：

```text
CLI → /chat → LLM
```

当前正确：

```text
CLI → LLM
```

### 不要让 React `useChat` 成为 Agent Loop

`useChat` 是 UI state/stream primitive。

真正的执行控制权属于：

```text
AgentLoop
```

### 不要把 Session DB Message 当作 Context Manager

完整历史存储和模型 Context 是两个概念。

后续应由 Context Manager 决定每次 Model Step 实际发送哪些内容。

### 不要把 cwd 当作 Sandbox

```text
cwd = workspace
```

只代表默认工作目录，不等于权限隔离。

### 不要让云同步错误直接终止本地 Run

Cloud persistence 应保持外围能力。

---

## 18. 下一阶段推荐顺序

Context Runtime v1、基础 Token Budget 与 Session Tree v1 已经建立。下一阶段不建议继续扩张 `AgentLoop` 本身，而应按以下顺序完善外围 Runtime：

```text
1. Canonical History / Event Store
      ↓
2. 精确 Model Profile + Tokenizer
      ↓
3. Compaction
      ↓
4. Local WAL / Cloud revision sync
      ↓
5. Tool Registry + Tool cancellation
      ↓
6. Permission Engine
      ↓
7. Sandbox
      ↓
8. Subagent on Session Tree
```

其中最近的核心目标应该是：

```text
Event History      = 实际发生了什么
Context Projection = 发给模型什么
UI Projection      = 给用户显示什么
Cloud Snapshot     = 用于恢复什么
```

彻底把四者分离，然后再实现自动 Compaction。

---

## 19. 相关长期架构记录

正式 ADR 位于：

```text
docs/decisions/
├── 0001-cloudflare-worker-api-edge-proxy.md
├── 0002-client-owned-agent-loop-runtime.md
├── 0003-local-first-agent-runtime-cloud-session-store.md
└── 0004-context-projection-and-resumable-session-tree.md
```

其中：

- ADR-0002 记录 Agent Loop 从隐式 AI SDK 行为迁移到 CLI/Harness 的过程；
- ADR-0003 是当前有效的 Local-first Runtime 边界决策，并取代了“Server 仍执行 Model Step”的旧设计；
- ADR-0004 记录 Context Projection 与可跳转/可分叉 Session Tree 的边界与持久化策略。

本文件属于近期工程状态快照，不替代正式 ADR。
