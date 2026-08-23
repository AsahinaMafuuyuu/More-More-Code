# MORE-MORE-CODE 当前实现与近期代码抉择

> 日期：2026-08-13
> 产品版本：v2.0.1
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
AgentLoop / Run Start
  ↓
Turn Start
  ↓
┌────────────────────────────────────────────┐
│ Model Step                                 │
│ CLI → LocalModelTransport → LLM Provider   │
└────────────────────────────────────────────┘
  ↓
模型是否请求 Tool？
  ├─ No  → Turn End → steering/follow-up queue → Run End 或下一 Turn
  └─ Yes
       ↓
     Tool Step(s)
       ↓
     CLI Local Tools
       ↓
     Tool Output
       ↓
     Turn End
       ↓
     steering 优先，否则 tool-continuation → 下一 Turn

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

Turn 已按照 pi-style runtime 语义调整为：**一次 Model response + 该 response 请求的全部 Tool executions**。

因此一次 Run 可以自然包含多个 Turn：

```text
Run
├── Turn 0 (initial)
│   ├── Model Step
│   ├── Tool Step
│   └── Tool Step
└── Turn 1 (tool-continuation)
    └── Model Step
```

Turn 当前包含：

- `id`
- `runId`
- `index`
- `cause`
- 可选 `inputMessageId`
- 可选 `interactionId`
- `status`
- `steps[]`

`cause` 明确记录该 Turn 为什么开始：

```text
initial
tool-continuation
steering
follow-up
```

steering / follow-up 不会修改正在执行中的 provider request，而是在当前 Turn 完成后的安全边界成为下一个 Turn 的输入。

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

Model / Tool Step context 现在都提供当前 Run 的 `AbortSignal` 与 `reportProgress()`。`reportProgress()` 只产生 ephemeral `step_update` lifecycle event，不写入 canonical Execution Event Store。

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
Run Start
   ↓
Turn Start
   ↓
Model Step
   ↓
tool calls?
   ├─ Yes → Tool Step(s) → Turn End
   │                         ↓
   │                  steering queued?
   │                    ├─ Yes → next Turn(cause=steering)
   │                    └─ No  → next Turn(cause=tool-continuation)
   │
   └─ No → Turn End
             ↓
      steering queued?
         ├─ Yes → next Turn(cause=steering)
         └─ No
             ↓
      follow-up queued?
         ├─ Yes → next Turn(cause=follow-up)
         └─ No  → Run End
```

因此 `Turn` 现在是真正的 runtime safe-point，而不是整个用户 submit 的外壳。

当前 AgentLoop 已实现：

- Model Step / Tool Step 显式编排；
- pi-style multi-Turn loop；
- 单次 Run 防并发执行；
- `AgentLoopBusyError`；
- Run-global `maxSteps` 与 `maxTurns` 保护；
- append-only Execution Events；
- `AgentRun` / `AgentTurn` / `AgentStep` 由事件 replay 得到，不再作为 canonical mutable state；
- `subscribe()` awaited lifecycle stream；
- `run_start/end`、`turn_start/end`、`step_start/update/end`；
- `currentRun` / `currentTurn` / `currentStep`；
- `isRunning` 与 settlement-aware `isBusy`；
- `waitForIdle()`，且 `run_end` listeners 属于 settlement barrier；
- Turn-safe `steer()` / `followUp()` queues；
- `clearSteeringQueue()` / `clearFollowUpQueue()` / `clearAllQueues()`；
- Run interrupt；
- Step 错误 → Turn / Run failed。

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

运行中输入框不再被禁用，而是提供 pi-style 交互：

```text
Enter       → steering
Alt+Enter   → follow-up
Escape      → interrupt Run
```

steering 在当前 Turn 的 Model + Tools 全部结束后消费，并优先于自动 tool continuation；follow-up 只在 Run 原本将结束时消费。

### 当前取消语义

Model Step 与 Tool Step 都已接入 Run 级 AbortSignal。Native command 执行由 Tool Runtime 传播取消信号；运行中的 shell 进程与输出读取会在 interrupt 后终止/取消，因此 Tool Step 不再需要等待原命令自然返回后才能结束。

这仍不等于 OS-level process sandbox 或完整的 descendant-process supervision；更强的进程隔离继续属于后续 Sandbox / process policy。

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

### 5.3 System Prompt + Agent Bootstrap

System Prompt 由 CLI 在每个 Model Step 前组装，Server 不参与 Prompt 构造。

CLI 启动时会先 bootstrap Agent Environment：

```text
~/.more-more-code/
├── config.json
├── AGENTS.md
└── skills/

<workspace>/.more-more-code/
├── config.json
├── AGENTS.md
└── skills/
```

Instruction Chain 固定按 global → project 加载，project 规则更具体；二者会进入 system prompt，但不会因此成为 Session Entry。

System Prompt 当前包含：coding-agent 基础行为、PLAN/BUILD 边界、Tools/Skills 区分、Skill metadata catalog，以及已解析的 Instruction Chain。完整 `SKILL.md` 不会启动时全部注入；只有模型调用 native `loadSkill` 后才按需取得完整内容。

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
loadSkill
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
loadSkill
```

BUILD 模式允许读写与 Shell 执行。

### 文件路径保护

文件型工具通过：

```text
resolveInsideWorkspace(workspaceRoot, path)
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

> 不创建新的 User Message，以当前 Message State 开启下一个 `tool-continuation` Turn 的 Model Step。

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

目前 Server 保存的是 **Session Entry Tree v3 Snapshot**，而不是 Run/Turn/Step Event Store。`messages: Json` 作为兼容性状态容器保存 `{ version: 3, rootEntryId, activeEntryId, entries[] }`；每一个 durable semantic event 自身就是带 `id / parentId / type` 的 Session Entry，不再使用 v2 的 checkpoint `nodes[] + eventIds[] + events[]` 双层结构。

Session Entry 可以是 user/assistant/custom message、`message_update`、tool call/result、error、model/mode/config change、compaction、branch summary 或 custom event。它和 Harness Execution Event Store 必须区分：前者记录可恢复、可分叉的 Session 语义历史，后者记录 Run/Turn/Step 执行生命周期。

---

## 11. 当前 UI Runtime 行为

Session UI 已开始以 Agent Run 作为主要状态边界。

Run 处于 `running` 时：

- 输入框保持可编辑；
- 普通 Enter 将新输入加入 steering queue；
- Alt+Enter 将新输入加入 follow-up queue；
- loading 显示；
- ESC 可以触发 interrupt；
- 新输入不会直接改变正在执行中的 Model/Tool Step，而是在 Turn-safe boundary 被消费。

steering 在当前 Turn 完成后优先于自动 tool continuation；follow-up 只在 Run 原本将进入 idle 时消费。follow-up 保持在同一个 Run / Execution Event history 中，但会开启新的 loop-budget epoch，因此 `maxSteps` / `maxTurns` 从该 follow-up 边界重新计数；steering 与 tool-continuation 不重置预算。

全局 Ctrl+C 行为已调整：Dialog / command / mention 等顶层 responder 仍可优先消费 Ctrl+C；正常会话状态下第一次未消费的 Ctrl+C 用于复制 OpenTUI 当前选区并启动 1 秒退出窗口，窗口内第二次 Ctrl+C 才销毁 renderer。InputBar 不再使用 Ctrl+C 清空输入。

同时：

- AI SDK transport error 会显示；
- Harness Run failure 也会显示；
- `run_end` listeners 完成前 `isBusy` 仍保持 true，即使 Run projection 已经 terminal。

---

## 12. 已实现测试

### Harness tests

当前覆盖包括：

1. 普通 Run 正常完成；
2. `model → tools → next Turn model` 的 multi-Turn 语义；
3. Model Step interrupt；
4. Tool Step 集成失败；
5. interaction-epoch `maxSteps` / `maxTurns` protection，follow-up 边界重置预算；
6. normal / failed / interrupted execution event sequence；
7. InMemoryExecutionEventStore append-only / duplicate / sequence / terminal validation；
8. Execution Events → Run / Turn / Step deterministic replay；
9. 多 Run execution projection；
10. `run_start/end` / `turn_start/end` / `step_start/update/end` lifecycle ordering；
11. `run_end` settlement barrier + `waitForIdle()`；
12. lifecycle listener 在 `step_start` interrupt；
13. lifecycle listener 在 `turn_end` queue steering；
14. steering safe-point consumption / tool-continuation priority；
15. follow-up idle-boundary consumption；
16. Step progress 不进入 canonical execution history；
17. Turn-aware Context budget / compaction；
18. Session Entry Tree v3 entry replay / branching / message & runtime-state projection / v1-v2 migration；
19. TokenCounter adapter；
20. follow-up 后 Step budget 独立重新计数；
21. follow-up 后 Turn budget 独立重新计数。

当前验证结果：

```text
36 pass
0 fail
```

### CLI regression tests

当前覆盖：

1. 新 user message 可以由 Harness 指定 ID；
2. Tool 后可以 continuation，不创建第二条 User Message；
3. Ctrl+C 第一次不退出、第二次在 1 秒窗口内退出；
4. Ctrl+C 双击窗口超时后重新从第一次计数。

当前验证结果：

```text
4 pass
0 fail
```

### 构建

2026-08-13 当前验证：

```text
Harness tests    36 PASS / 0 FAIL
CLI tests         4 PASS / 0 FAIL
Total tests      40 PASS / 0 FAIL
Harness type     PASS
CLI typecheck    PASS
Server typecheck PASS
CLI build        PASS
Server build     PASS
git diff --check PASS
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

- Run / Turn / Step projection；
- Agent Loop；
- Execution Event schema；
- In-memory ExecutionEventStore；
- Execution projection / replay；
- interruption；
- max step protection；
- Context projection / compaction；
- Session Tree runtime。

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
Current transition:
Cloud Session Store + Auth/Billing

Accepted target (ADR-0023):
Optional Multi-device Session Sync / Backup
Account / Subscription / Entitlements
```

不是：

```text
Agent Runtime Server
LLM Gateway
Tool Coordinator
Provider Credential Store
Canonical Local Session Authority
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

## 16. 当前 Harness / Agent Environment 阶段状态与未实现能力

Agent Loop、Context / Session Runtime、Execution Event Runtime 三个基础阶段已经完成；当前进一步完成了 **Stage 4.1 Agent Bootstrap**、**Stage 4.2 Skill Registry** 与 **Stage 5 Context & Provider Runtime**。WAL、安全层、完整 MCP Runtime 与 Subagent 仍未实现。

### 16.1 Context Manager：已完成 cache-aware canonical ordering

`packages/harness/src/context.ts` 已形成与 React / AI SDK 解耦的 Context Runtime：

- 输入 `ContextRecord<TPayload>[]`，输出不可变 `ContextProjection`；
- Record 现在显式区分 `category` 与 `stability`，覆盖 core/global/project instruction、skill catalog、tool definition、checkpoint、history、retained tail、runtime continuation 与 current input；
- `compileContextRecords()` 固定按“最稳定 → 最动态”排序，稳定集合可用 `deterministicKey` 做确定性排序；
- `groupId` 将同一 Turn 的 user/assistant records 作为原子组；
- required groups / retained tail 不会被预算裁掉；
- 可选历史只保留连续的最近 suffix，不跨越一个被裁掉的大 Turn 去捡更旧的小消息；
- projection 显式返回 selected / omitted records、`truncated` / `overBudget`；
- 原始 canonical history 永远不因 context projection 或 compaction 被改写。

CLI `LocalModelTransport` 先将经过校验的 UI Messages 映射为 Context Records，再执行 projection/compaction，最后才转换为 Provider `ModelMessage`。System/global/project instructions 与 Skill metadata 以固定顺序进入系统前缀；Tool schemas 仍通过 Vercel AI SDK 的独立 `tools` 参数传递，但会进入确定性的 ToolSet snapshot/fingerprint，因此不会为了“统一上下文”而重复塞进消息文本。

仍可继续扩展：

- selected files / project memory；
- provider 官方精确 tokenizer implementation；
- 更细粒度的 runtime continuation/current-input Context Record 构造。

### 16.2 Token Budget：已完成 ModelProfile + TokenCounter adapter

新增 `packages/harness/src/token-budget.ts`：

```text
ModelContextProfile
├── contextWindowTokens
├── reservedOutputTokens
├── safetyMarginTokens
├── retainedTailTurns
├── maxSummaryTokens
├── compactionSoftLimitRatio
├── compactionHardLimitRatio
├── postCompactionTargetRatio
└── tokenCounter
```

CLI 在 `model-context-profile.ts` 为每个模型显式解析 profile，并按 provider 选择 token counter。当前内置 counter 是 provider-calibrated heuristic estimator，并明确标记 `accuracy = estimated`；Harness 同时提供 `createExactTokenCounter()`，未来接入官方/第三方精确 tokenizer 时无需修改 ContextManager API。

### 16.3 Compaction：已升级为 budget-aware semantic v2

Compaction 不再等到 provider 输入真正溢出才开始。当前默认应用策略按有效 input budget 计算：

```text
< 80%          正常复用当前 checkpoint
80% ~ 92%      soft-limit，可主动 compaction
92% ~ 100%     hard-limit，优先回收历史
> 100%         overflow，必须尝试 compaction

compaction 后目标：约 70%
```

Harness 只允许 optional `historical-conversation` groups 进入 compaction source，并按 `groupId` 保证完整 Turn / 原子交互不会被 token cut point 拆开。Selector 从最近历史向前保留能落入 post-compaction working-set target 的完整 groups，把更旧的连续 prefix 交给 `ContextCompactor`。required records、retained tail、stable instructions 与 current/runtime continuation 不参与这种切分。

Compaction 的语义现在是增量 state reduction，而不是 chronology truncation：

```text
previous effective checkpoint
            +
newly compacted complete history
            ↓
LLM semantic state reducer
            ↓
complete replacement snapshot
            +
raw retained recent turns
```

CLI reducer 使用固定 Markdown schema：`Current Goal / Current State / Decisions / Constraints / Artifacts / Failures and Lessons / Pending Work`。Prompt 明确要求保留仍然有效的事实、用后来的明确决策覆盖 superseded facts，并优先表达“现在什么是真的”而不是复述事件时间线。若 semantic reducer/provider 调用失败、返回空结果或无法在 summary budget 内形成 checkpoint，则自动回退到 bounded deterministic compactor，避免让次要的 context optimization 成为主 Model Step 的新可用性依赖。

实际发生 compaction 时，CLI 在当前 Session branch 追加 `compaction` Entry，除 replacement snapshot、被压缩 message IDs 与 retained IDs 外，还记录 `soft-limit | hard-limit | overflow` trigger、input before/after、effective budget、post-compaction target、summary target 与 compacted-through message ID；源 Session Entries 以及旧 checkpoint 都不会删除。

后续 Model Step 或会话恢复后，通过 active branch 最新 `compaction` Entry 直接复用 snapshot，并跳过已经由 checkpoint 表示的旧 messages。`compact(N+1)` 只读取 `compactN + 新被压缩历史`，不会重新总结完整 Session，也不会在每个 Model Step 重复生成等价 snapshot。Branch Summary 仍是跳转分支时的 knowledge-transfer 机制，与 active-context Compaction 保持独立。

### 16.4 Execution Event + Lifecycle Runtime：已完成进程内 v2

Run / Turn / Step 已经从 mutable canonical state 改为 **event-backed projection**，同时补齐 pi-style lifecycle 与 Turn-safe interaction runtime。

新增：

```text
packages/harness/src/
├── execution-events.ts
├── execution-store.ts
├── execution-projection.ts
└── lifecycle.ts
```

当前生命周期事件包括：

```text
run.started / completed / failed / interrupted
turn.started / completed / failed / interrupted
step.started / completed / failed / interrupted
```

每个事件包含 stable event id、`sessionId` / `runId`、per-run monotonic `sequence`、timestamp，以及对应 Turn/Step/tool/error metadata。

`InMemoryExecutionEventStore` 当前负责 append-only 记录，并验证：

- duplicate event id；
- sequence gap / out-of-order；
- session mismatch；
- terminal Run 后继续追加事件。

`AgentLoop` 不再直接把 Run/Turn/Step mutable object 当作事实来源。`currentRun`、adapter context、`onStateChange` 以及 `run()` 返回值都由 `projectAgentRun(events)` replay 得到。

Turn 现在定义为“一次 Model response + 该 response 的 Tool executions”；工具结果触发后续模型调用时会开启新的 `tool-continuation` Turn。`turn.started` 额外保存 `cause`，可取 `initial / tool-continuation / steering / follow-up`。

另外新增 ephemeral lifecycle stream：

```text
run_start / run_end
turn_start / turn_end
step_start / step_update / step_end
```

`subscribe()` listeners 按注册顺序 awaited；`run_end` 属于 settlement barrier，`waitForIdle()` 只会在这些 listeners 完成后返回。`step_update` 不写入 ExecutionEventStore。

交互层新增 `steer()` / `followUp()` queues：steering 在 Turn safe-point 优先于 tool continuation，follow-up 只在 Run 原本将结束时消费。生命周期 listener 可以在安全 phase 调用这些控制 API；如果在 `turn_start` / `step_start` 触发 interrupt，Harness 会在启动 provider/tool 前停止。

当前明确拆分为：

```text
Session Entries          = Session 中可恢复、可分叉的 durable semantic history
Execution Events         = Agent 的 Run / Turn / Step 实际执行了什么
Context Projection       = 当前 Model Step 发给模型什么
Message / UI Projection  = 当前 branch 中哪些内容作为消息/界面显示
Runtime State Projection = 当前 branch 恢复出的 model / mode / config
Cloud Snapshot           = 跨进程/设备恢复什么
```

Stage 6.0 已将 Execution Events 的本地 durable persistence 接入默认 CLI 路径：`RuntimeSession` 使用独立 SQLite Runtime Store 做 write-ahead append、snapshot + replay recovery 与 Projection Cache warming。Cloud execution-event sync 仍未实现；恢复只报告未完成外部工作，不自动重放。

### 16.5 Permission Engine

Harness 现在是权限语义的唯一接口权威：

```text
PermissionRequest(capability, ephemeral resource kind/value/scope)
  ↓
RulePermissionPolicy(code defaults → global overrides → project overrides)
  ↓
PermissionDecision(allow | deny | ask, default | configured)
  ↓
Tool Runtime enforcement
```

规则支持 capability、command、path、generic resource 与 `workspace | outside-workspace | agent-config | external` scope；同一规则内各维度为 AND，pattern 数组为 OR，普通规则按声明顺序 last-match-wins。最终不可覆盖的 `outside-workspace` deny 保持 policy 与 native executor 一致。路径 glob 中 `*` 不跨 segment、`**` 可跨 segment，Windows 按不区分大小写匹配。Tool Registry 与 native filesystem executor 共享 canonical resolver：既有 symlink/junction 解析真实目标，新建目标解析最近存在父目录。Tool Runtime 对每个 capability 逐项 awaited evaluation，并在 executor 前执行最终结果。

权限 Runtime Event 使用独立的 schema v2 `requested | decided` lifecycle，同时兼容读取旧 v1 decision；Stage 6.2 又增加独立 schema v3 `approval.lifecycle requested | resolved | cancelled | timed_out`。持久化内容只有 capability、resource kind、scope、decision/source、approval ID 与 correlation IDs；原始命令、路径、Tool input/output 和 policy reason 不进入 Runtime Store。

`ask` 不再由 Permission Engine 假装批准，也不再成为模型可见死路：Stage 6.2 由独立 Approval Broker 在原 Tool Step 内等待 `Allow once | Deny`。Permission Engine 仍只负责规则判断；OS-level Sandbox 仍未实现。

### 16.6 Sandbox

当前没有真正的进程 Sandbox。

尤其 `bash` 仍需要：

- workspace filesystem isolation；
- network policy；
- process policy；
- environment filtering；
- privilege boundary。

### 16.7 Tool Registry

Tool Registry / Tool Runtime 边界已经建立；native executor 内部仍通过集中 switch 分发具体实现。

当前职责已经包含：

```text
Tool Registry
├── contract
├── executor
├── permission
├── timeout
├── cancellation
└── telemetry
```

### 16.8 Session Entry Tree：已升级 v3 semantic history；Subagent 尚未实现

当前 Session 不再把“一个 Turn/Run 完成后的 checkpoint”当作树节点，而采用 Pi-inspired **Session Entry Tree**：

```text
session_start
  └─ model_change
      └─ mode_change
          └─ user_message
              └─ assistant_message
                  ├─ tool_call → tool_result → message_update → ...
                  └─ user_message' → assistant_message' → ...
```

核心规则是：

> 一个 durable semantic event = 一个 Session Entry = 一个可分叉树节点。

当前 Entry 类型包括：

```text
Conversation
- user_message
- assistant_message
- custom_message
- message_update

Tool / semantic execution
- tool_call
- tool_result
- error

Runtime state
- model_change
- mode_change
- config_change

Context / extension
- compaction
- branch_summary
- custom
```

每个 Entry 都有 stable `id`、`parentId`、`createdAt`、`type`，并可选择关联 `runId / turnId / stepId / inputMessageId`。Entry identity 与 message/tool/run identity 分离。

`activeEntryId` 是当前 continuation cursor。CLI 跳转任意 Entry 后，会沿 `session_start → activeEntry` 分别重放：

- Message Projection：只生成聊天消息；
- Runtime State Projection：恢复 model / mode / config；
- `/tree` UI Projection：展示包括 tool/state/error/compaction 在内的完整 Session Entries。

历史 assistant message 因 tool result 等原因发生内容变化时，不修改旧节点，而追加 branch-local `message_update` Entry，因此 sibling branch 不会互相污染。Tool call/result 也作为独立 Session Entry 持久化，即使 provider message format 同时把 tool call 编码在 assistant content 中。

实际发生 Context compaction 时会追加 `compaction` Entry，但旧 Session history 永远保留。Run/Turn/Step 的 start/end/progress 仍属于独立 Execution Event / lifecycle 层，不会因为 v3 而全部塞进 Session Tree。

当前命令：

```text
/tree    浏览完整 Session Entry Tree 并跳转任意 Entry
/jump    打开 Entry 跳转器
/parent  跳转当前 Entry 的父 Entry
/root    跳转 session_start 根 Entry
```

Session Entry Tree 继续通过 `POST /sessions/:id/state` 保存到现有 Session JSON 字段，因此仍不要求 Prisma migration。CLI 可把旧线性 messages array、v1 per-node snapshots、v2 checkpoint + message-upsert event tree 升级为 v3；Server 在兼容期接受 v1/v2/v3 state。增量 Session snapshot POST 在 CLI 端串行化，避免旧请求后完成而覆盖新状态。

仍未实现：

- Subagent child runtime 与 parent/child Session linkage；
- subagent context/result projection；
- Session / Execution Events 的 Local WAL + crash recovery；
- 多设备 revision / conflict resolution。

### 16.9 Agent Bootstrap + Skill Registry：Stage 4.1 / 4.2 已完成

CLI 现在在 renderer 和 Session Run 创建前完成 Agent Bootstrap。新增模块：

```text
packages/cli/src/lib/
├── agent-config.ts
├── agent-environment.ts
├── instruction-resolver.ts
├── skill-registry.ts
└── tool-registry.ts
```

当前规则：

- `~/.more-more-code` 为用户全局配置目录；
- `<workspace>/.more-more-code` 为项目配置目录；
- `config.json` 按 global → project 合并，项目覆盖全局；
- `AGENTS.md` 按 global → project 形成 Instruction Chain；
- Skills 从 `~/.agents/skills`、`~/.more-more-code/skills`、`<workspace>/.more-more-code/skills` 三层发现；同名优先级为 `agents < global < project`；
- 启动只读取 Skill metadata，不预载完整 Skill body；
- `loadSkill` 是 read-only native tool，可在 PLAN/BUILD 中按名称加载完整 Skill；
- Tools 与 Skills 是独立 domain；Tool Registry 显式区分 `native` 与 `mcp` source；
- MCP server 已可在配置中表达，但 MCP transport/auth/remote execution 本阶段没有实现；
- `/settings` 可检查两级配置与兼容 `.agents` Skill 路径、打开 config/AGENTS/`.agents/skills` 并 reload Agent Environment。

本阶段明确不做 WAL、Permission/Sandbox 重构和 Subagent。

### 16.10 Context & Provider Runtime：Stage 5 已完成

Stage 5 把“上下文预算”进一步升级成**缓存稳定的 Model Step 编译链**。新增/扩展的核心模块包括：

```text
packages/harness/src/context.ts
packages/cli/src/lib/cache-identity.ts
packages/cli/src/lib/provider-runtime.ts
packages/cli/src/lib/local-model-transport.ts
packages/cli/src/lib/tool-registry.ts
packages/cli/src/lib/system-prompt.ts
```

当前 Model Step 的稳定前缀逻辑是：

```text
Core coding-agent prompt
→ Global instructions
→ Project instructions
→ Skill catalog metadata
→ Tool definitions / schemas
→ persisted compaction checkpoint
→ history / retained tail / runtime / current input
```

其中 Skill catalog 与 ToolSet 都按确定性顺序序列化。Tool Registry 会为当前模式生成 `ToolSetSnapshot`，再派生 `ToolSetFingerprint`；provider/model/mode、system prompt version、global/project instruction hash、skill catalog hash 与 tool fingerprint 共同生成 `PromptPrefixFingerprint`。因此 PLAN 与 BUILD 因暴露 ToolSet 不同，自然属于不同 cache family。

Provider 侧新增独立 request compiler boundary。OpenAI 模型显式通过 `openai.responses(model)` 选择 Responses API；`OpenAIResponsesAdapter` 从 `PromptPrefixFingerprint` 派生 `promptCacheKey`，同时继续让 Vercel AI SDK 负责 streaming、tool-call integration 与 UI message normalization。`previousResponseId` 没有进入 adapter，也不会替代本地 Session Entry Tree。

Provider usage 会规范化成诊断 telemetry：input/output tokens、cache read/write tokens、provider/model、prompt/tool fingerprints。该数据保留在 LocalModelTransport 的 runtime diagnostics/callback 中，不会自动写成 Session semantic Entry。

本阶段测试覆盖 canonical ordering、PLAN/BUILD fingerprint 差异、checkpoint reuse/replacement、OpenAI provider compilation 与 cache telemetry；完整 Harness + CLI 测试、Harness/Shared/CLI/Server typecheck、CLI/Server build 均通过。

---

### 16.11 Session/Context 语义收口与 Tool Runtime：Stage 5.1 / Stage 6

本轮进一步固定了四条 Session/Context 不变量：

1. Session Entry 是 append-only durable fact；从历史 Entry 继续时新增 child branch，不原地改写既有 Entry；
2. 新 checkpoint 由“上一有效 checkpoint + 新被压缩历史”生成，旧 compaction 仍留在 Session Tree，但 Model Context 只使用 active branch 最新有效 checkpoint；
3. restore 的 durable authority 仍是 `Session Tree + activeEntryId`，Message / Runtime / Context checkpoint 都从当前 branch 投影；
4. Session Tree 的 message/tool/compaction/state/branch/error/custom/timestamp 颜色进入 Theme semantic tokens。

同时新增 `packages/cli/src/lib/tool-runtime.ts` 作为 AgentLoop 与具体 Tool Source 之间的本地运行时边界。Tool Registry 现在除了模型可见 contract snapshot 外还提供 capability metadata；Tool Runtime 统一处理 mode visibility、`allow | deny | ask` permission seam、AbortSignal/timeout propagation、source adapter 选择与 normalized execution result。`tool_result` Entry 增加可选 `status/source/startedAt/completedAt/durationMs` 字段，并保持旧 `output/error` 兼容。

CLI `runToolStep` 已将 Harness 提供的 Run/Turn/Step `AbortSignal` 传入 Tool Runtime。filesystem read/write、grep 与 bash 路径都能够消费该 signal。Stage 6.1 已补齐 native shell cancellation：bash 使用 Runtime workspace root，运行中的 shell 与输出读取会响应 interrupt；bash 的 command timeout 也通过 executor timeout resolver 交由 Tool Runtime 统一生成 normalized `timed_out` outcome，不再由 native implementation 维护第二套 timer。

### 16.12 Recoverable Runtime Permission Enforcement：Stage 6.0 Phase 5

Phase 5 已完成 Harness/CLI permission contract 收口、两级 persisted override、Tool capability/resource classification、canonical workspace containment、Tool Runtime enforcement 与 redacted request/decision persistence。RuntimeSession 同时补齐两条 write-ahead 一致性：同一 Session 的 append/reduce/cache/snapshot 操作串行执行，避免并发返回导致 offset 倒序应用；snapshot 属于派生加速，写入失败不会让已经成功持久化的 event append 对 AgentLoop 假失败，失败次数/时间保留为进程内诊断并采用 bounded backoff 重试。

CLI Tool Step 现在区分 normalized executor outcome 与 permission/observer/Runtime Store infrastructure exception。前者作为 Tool Result 返回模型；后者在记录 UI/Session error 后重新抛给 AgentLoop，使 Step/Run failed 并阻止后续外部副作用。

### 16.13 Derived Security Audit & Lifecycle Validation：Stage 6.0 Phase 6

Phase 6 已在 Harness 增加 `projectSecurityAuditTimeline(sessionId, events)`，直接从 session-scoped Runtime Event stream 派生权限审计时间线，而不把完整 audit history 写入 `RuntimeSessionProjection` 或 snapshot。schema-v2 `requested / decided` 通过 Run/Turn/Step/Tool-call/capability 关联，v1 decision 保留为 `legacy` 条目；投影显式区分 `complete / pending / legacy / inconsistent` 并保留 durable offsets 作为证据。

Replay 的定义固定为 **security lifecycle consistency replay**，而不是 policy recomputation。由于 v2/v3 按 ADR-0019/0021 不持久化 raw command/path/resource value，重启后不能严谨重跑原始 `matchesPermissionRule()`；审计层只验证可由 durable facts 证明的结构和 enforcement invariants。Stage 6.0 的 permission-only 历史中 `ask -> approval_required`；Stage 6.2 新历史则通过 schema-v3 approval 证明 `ask + allow -> executor`，并验证 deny/cancel/timeout 与 Tool terminal 一致。危险操作回归同时覆盖组合 command pattern、multi-capability blocking、absolute/symlink/junction workspace escape，以及 policy/observer failure 的 fail-closed 行为。命令 glob 仍属于应用层 policy，不等于 shell parser 或 OS-level Sandbox。

### 16.14 Interactive Approval & Permission UX：Stage 6.2

Stage 6.2 将 `ask` 从 fail-closed 的产品死路升级为真实的一次性人类审批事务，同时保持 `PermissionPolicy` 与交互式批准分离。Harness 新增 `ApprovalBroker` contract；CLI 使用 process-local `InteractiveApprovalBroker` 管理 pending transaction。Tool Runtime 会先完成同一 Tool Call 的所有 capability evaluation：任一 deny 直接阻止且不会弹框；没有 deny 时，所有 ask requirements 聚合成一个 approval request。用户 `Allow once` 后继续**同一个 Tool Step**，不要求模型重发 Tool Call；Deny、Escape/关闭 Dialog、Run interrupt 与 approval timeout 均不会执行 executor。

审批 UI 可以显示 process-local 的 raw command/path/resource value 以帮助用户判断，但这些值不会跨 durable seam。schema-v3 `approval.lifecycle` 只持久化 `approvalId`、ask requirement 的 capability/resourceKind/scope 与 Run/Turn/Step/Tool-call correlation；终态为 `resolved allow|deny`、`cancelled` 或 `timed_out`。`approval_requested` 必须先 durable append 才会进入 broker；用户 Allow 后，`approval_resolved` 也必须先 durable append 才能调用 executor。任一 observer/Runtime Store/broker infrastructure failure 都保持 fail-closed。

Stage 6.0 的 derived security audit projector 已扩展到 v3 approval：旧 v1/v2 permission-only history 仍保持兼容；新历史允许 `ask + approval allow -> executor terminal`，并检查 approval deny/cancel/timeout 与 Tool terminal 的一致性。Stage 6.2 只提供 `Allow once / Deny`，不会自动写 global/project permission config；allow-for-session/project、shell-AST-aware command authorization、MCP authorization 与 OS-level Sandbox 继续独立后置。

### 16.15 Sandbox Execution Foundation & Process Hardening：Stage 6.3

Stage 6.3 在 native Tool executor 下增加独立 `ProcessSandbox` 深模块。PermissionPolicy 继续回答“能否执行”，ApprovalBroker 回答“人类是否对这一次 Tool Call 同意”，Tool Runtime 继续负责 Tool lifecycle/timeout/cancellation；ProcessSandbox 只负责“已获授权的子进程如何被启动和约束”。`bash` 与 `grep` 已不再直接创建进程，CLI 中唯一 `Bun.spawn` 收口到这个 seam。

两级 Agent Config 新增 strict `sandbox` 对象：`mode=off|auto|required`、`network=inherit|deny`、`environment=inherit|safe`、`envAllow[]`。未知字段直接拒绝，避免安全配置拼写错误被静默降级。默认 `auto + network inherit + environment safe`；safe environment 只保留 PATH/temp/locale/shell 等运行变量及显式 `envAllow`，不把 ambient Provider/API credentials 自动传给 shell。`required` 没有 provider 时在 spawn 前 fail-closed；`network=deny` 也不能在 `auto` 中无提示降级为 direct networking。

Linux provider 使用可发现的 Bubblewrap：host root 只读 bind，canonical workspace root 单独可写 bind，home 通过 tmpfs 遮蔽，`/tmp` 私有，并启用 PID/IPC/UTS namespace；`network=deny` 再加入 network namespace。ProcessSandbox 的接口显式区分 `workspaceRoot` 与 `cwd`，并在模块内部验证 `cwd ⊆ workspaceRoot`，因此未来新增 process-backed Tool 不能只靠调用约定决定可写范围。该 profile 的目标是 workspace-write/process/network isolation，不宣称完全 host-read confidentiality。

当前 Windows 开发环境没有 Bubblewrap/nsjail/firejail 类型 provider，Stage 6.3 不把 safe environment、cwd 或 canonical path 包装成伪 Sandbox：`auto` 只在没有硬约束时报告 unisolated direct fallback，`required` 则拒绝 spawn。后续 Windows AppContainer/restricted-token/Job-object adapter 可直接实现同一 seam，而不改 AgentLoop/ToolRuntime/native Tool 调用面。`/settings` 已显示实际 Sandbox provider 和 fallback/unavailable 原因。

### 16.16 Local Provider / Session Authority & Optional Cloud：ADR-0023（Accepted / Planned）

2026-08-23 已接受 ADR-0023，但该架构迁移尚未作为实现交付完成。当前代码状态必须和目标状态明确区分：

- **已经成立：** Model Step、AgentLoop、Tools、Context、Permission、Approval、ProcessSandbox、Runtime Store 都在本地 CLI；Server 不执行模型。
- **仍是过渡态：** Session create/list/get/whole-tree snapshot 仍由 Server/PostgreSQL 提供；Provider/model 仍存在 fixed catalog + resolver 假设；Provider secret 主要来自 ambient environment。
- **目标：** Local Session Store 成为语义 Session 的物理持久化 authority；Provider Registry/Credential Store/Auth Strategy 全部本地化；Server 只作为可选 Session Sync/Backup + account/subscription/entitlement cloud。

Provider V1 的 accepted surface 固定为：

```text
Built-in ProviderKind
  openai
  anthropic
  google
  deepseek

Custom
  OpenAI-compatible endpoint
  multiple user-defined ProviderId values
```

Mistral 从 Stage 6.4+ built-in provider surface 移除。模型选择不再长期绑定 closed `SupportedChatModelId`，而迁移为 `{ providerId, modelId }` `ModelRef`。推荐模型目录仍可提供定价、Context profile 和 UX default，但不再承担全局 allowlist 角色。

Auth 与 Provider configuration 分离。首发为：OpenAI `api-key | codex-oauth(experimental)`；Anthropic/Google/DeepSeek `api-key`；Custom OpenAI-compatible `api-key | bearer | none`。Anthropic OAuth 明确不设计；Google OAuth/Vertex ADC 后续研究。Codex OAuth 不允许通过复制 `~/.codex` 私有 token 文件实现，也不能把 undocumented token 当作稳定通用 OpenAI API credential。

Provider account/endpoint config 计划存放在 user-global `~/.more-more-code/providers.json`；project `.more-more-code/config.json` 最多引用 provider/model default，不保存账户 secret。Credential 由独立 `CredentialStore` deep module 管理，目标适配 OS-native secret store。

Session 持久化路线也相应变化：Stage 6.5 先让 local create/list/get/append 完全脱离 Server；Stage 6.6 再将 Cloud Sync 从 whole-tree last-write-wins 改为 append-oriented + idempotency + revision/cursor merge。`activeEntryId`、expanded nodes、scroll position 等 device UI/navigation state 默认不作为跨设备 semantic sync 数据。

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

## 18. 当前阶段边界与后续候选

Stage 4.1 Agent Bootstrap、Stage 4.2 Skill Registry、Stage 5 Context & Provider Runtime、Stage 5.1 Session/Context 语义收口、Stage 6 Tool Runtime 第一版、Stage 6.1 native shell cancellation、Stage 6.0 recoverable runtime / permission enforcement / security audit validation、Stage 6.2 interactive approval，以及 Stage 6.3 process Sandbox foundation 均已完成。当前从启动到 Model Step / Tool Step 的链路已经形成：

```text
CLI bootstrap
  ↓
Global .more-more-code
  ↓
Project .more-more-code
  ↓
Instruction Chain + Skill metadata + Tool Registry
  ↓
Cache-aware Context Compiler + Prefix Fingerprints
  ↓
Provider Adapter / Model Step
  ↓
AgentLoop Tool Step
  ↓
Tool Runtime → Registry / Effective Permission Policy
  ↓ ask only
Interactive Approval Broker → Allow once / Deny
  ↓ allow
Tool Executor / Timeout / Source Adapter
  ↓ native process-backed Tool
ProcessSandbox → provider / safe env / workspace-write constraint
  ↓
Redacted Runtime Events → SQLite snapshot + replay
```

Stage 6.3 已把 native process creation 收口到 ProcessSandbox，并在 Linux/Bubblewrap 可用时提供 workspace-write/process/network isolation。ADR-0023 已重新排序后续依赖：Stage 6.4 先完成 Provider Runtime/Local Auth foundation；Stage 6.5 建立 Local Session authority 并移除 Server 必选依赖；Stage 6.6 再做 multi-device Session Sync + commercial entitlements；原本建议优先的 Windows native isolation 移到 Stage 6.7。MCP remote Tool trust、Cloud Runtime Event sync、allow-for-session/project、shell-AST-aware authorization、exact tokenizer 或产品级 Subagent runtime 仍可独立推进；其中任何一项都不应重新把职责塞回 `AgentLoop`、`ContextManager` 或 Server model proxy。

当前关键边界已经分离：

```text
Session Entries          = Session 的 durable semantic history 与 branch topology
Execution Events         = Run / Turn / Step 实际发生了什么
Context Projection       = 当前 Model Step 发给模型什么，以及 stable→dynamic ordering / compaction checkpoint
Provider Runtime         = provider-specific model/options/cache telemetry 编译
Tool Runtime             = tool visibility / capability / policy / cancellation / timeout / normalized result
Approval Broker          = process-local human approval transaction / Allow once / Deny
Process Sandbox          = native subprocess provider / environment / writable workspace / OS isolation policy
Message / UI Projection  = 当前 branch 显示哪些聊天/树信息
Runtime State Projection = 当前 branch 恢复哪些 model / mode / config
Agent Environment        = 当前进程加载了哪些 global/project instructions、skills 与 tool sources
Provider Registry        = user-global provider identity/kind/non-secret endpoint/model configuration（Stage 6.4）
Credential Store         = local provider secret storage / auth credential resolution（Stage 6.4）
Local Session Store      = semantic Session local persistence authority（Stage 6.5）
Cloud Session Sync       = optional append-oriented multi-device Session synchronization（Stage 6.6）
Cloud Entitlements       = optional account/subscription feature capability, not Agent runtime authorization（Stage 6.6）
```

下一阶段按 ADR-0023 与 `tasks/plan.md` 执行 Stage 6.4 Provider Runtime，而不是继续扩大 `AgentLoop` 或先把 Server 扩回模型执行路径。

---

## 19. 相关长期架构记录

正式 ADR 位于：

```text
docs/decisions/
├── 0001-cloudflare-worker-api-edge-proxy.md
├── 0002-client-owned-agent-loop-runtime.md
├── 0003-local-first-agent-runtime-cloud-session-store.md
├── 0004-context-projection-and-resumable-session-tree.md
├── 0005-event-backed-session-history-and-context-compaction.md
├── 0006-event-backed-agent-execution-runtime.md
├── 0007-pi-style-run-turn-step-lifecycle-and-interaction.md
├── 0008-session-entry-tree-and-semantic-session-history.md
├── 0009-agent-bootstrap-instructions-skills-and-tool-sources.md
├── 0010-cache-aware-context-and-provider-runtime.md
├── 0011-session-runtime-invariants.md
├── 0012-semantic-context-compaction.md
├── 0013-tool-result-working-set-and-manual-compaction.md
├── 0014-lazy-branch-knowledge-transfer.md
├── 0015-sqlite-runtime-event-store-and-security-foundation.md
├── 0016-separate-cloud-session-and-local-runtime-stores.md
├── 0017-production-runtime-wiring-and-redacted-event-protocol.md
├── 0018-governed-multi-agent-collaboration.md
├── 0019-effective-permission-policy-and-redacted-lifecycle.md
├── 0020-derived-security-audit-and-lifecycle-replay.md
├── 0021-interactive-tool-approval-transactions.md
├── 0022-sandbox-execution-seam-and-linux-bubblewrap.md
└── 0023-local-session-authority-provider-runtime-and-optional-cloud.md
```

其中：

- ADR-0002 记录 Agent Loop 从隐式 AI SDK 行为迁移到 CLI/Harness 的过程；
- ADR-0003 是当前有效的 Local-first Runtime 边界决策，并取代了“Server 仍执行 Model Step”的旧设计；
- ADR-0004 记录 Context Projection 与可跳转/可分叉 Session Tree 的基础边界；其旧 checkpoint-node granularity 已由 ADR-0008 部分取代；
- ADR-0005 记录旧 v2 canonical message-event history、Turn-aware compaction 与 TokenCounter adapter；其 Session history representation 已由 ADR-0008 部分取代；
- ADR-0006 记录 append-only Execution Events、ExecutionEventStore 与 Run/Turn/Step projection 的设计，仍然有效；
- ADR-0007 记录 pi-style Turn 语义、awaited lifecycle stream、steering/follow-up safe-point interaction 与 settlement 规则；
- ADR-0008 记录 Session Entry Tree v3：durable semantic Entry、Message/Runtime State Projection、tool/state/compaction entries、v1/v2 migration 与持久化边界；
- ADR-0009 记录 `.more-more-code` 两级 Agent Bootstrap、Instruction Chain、Skill progressive disclosure 与 native/MCP Tool Source 边界；
- ADR-0010 记录 stable→dynamic Context ordering、Tool/Prompt prefix fingerprint、persisted compaction checkpoint reuse、Provider Adapter 与 OpenAI Responses/cache 边界；
- ADR-0011 记录 append-only Session、compaction supersession、restore authority、semantic Theme tokens 与 Tool Runtime 边界。
- ADR-0012 记录 soft/hard proactive compaction、atomic cut point、incremental semantic state reducer、deterministic fallback 与 richer checkpoint diagnostics。
- ADR-0013 记录 Tool Result Working Set、manual compaction eligibility 与职责分离。
- ADR-0014 记录 lazy Branch Summary knowledge transfer、coverage/provenance 与 navigation 语义。
- ADR-0015/0016/0017 记录 SQLite Runtime security foundation、两套 persistence store 分离与 production write-ahead/redaction/recovery wiring。
- ADR-0018 记录仓库级受治理多代理协作规则。
- ADR-0019 记录 effective permission policy、Tool Runtime enforcement 与 redacted schema-v2 permission lifecycle。
- ADR-0020 记录 derived security audit timeline、lifecycle consistency replay 与 application policy / OS Sandbox 边界。
- ADR-0021 记录 Tool-call approval transaction、PermissionPolicy/ApprovalBroker 职责分离、same-Step resume 与 redacted schema-v3 approval lifecycle。
- ADR-0022 记录 native subprocess ProcessSandbox seam、strict fallback semantics、safe child environment、Linux Bubblewrap profile 与 Windows native isolation 缺口。
- ADR-0023 接受 Local Session authority、四个 built-in Provider + Custom OpenAI-compatible、Credential/Auth seam、Codex OAuth experimental 策略，以及 Optional Cloud Sync/Subscription 的产品边界；它只 supersede ADR-0003 的 cloud Session authority 部分，保留 ADR-0003 的 client-owned Agent/model execution 决策。

本文件属于近期工程状态快照，不替代正式 ADR。
