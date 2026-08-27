# MORE MORE CODE

> **终端里的 AI 编程助手** — 在终端中与 AI 对话，让 AI 直接操作你的代码。
>
> 当前版本：**v1.1.0**

一款基于 **Bun + TypeScript Monorepo** 构建的终端 TUI（Text-based UI）应用。它让你在终端中与 GPT / Claude / DeepSeek 等 AI 模型交互，AI 可以读取、编辑你的项目文件，执行 shell 命令，真正辅助你写代码。

---

## ✨ 功能特性

- 🖥️ **全终端 TUI 界面** — 基于 OpenTUI + React，无需离开终端
- 🤖 **多模型支持** — 支持 OpenAI、Anthropic、DeepSeek 等多个 AI 模型，随时切换
- 🔀 **双工作模式** — `PLAN`（只读分析）和 `BUILD`（完整读写），Tab 键一键切换
- 🛠️ **AI 工具调用** — AI 可直接读文件、写文件、编辑文件、搜索代码、执行命令
- 🎨 **9 种配色主题** — 从 Nightfox 到 Sakura Pulse，满足不同审美
- 📜 **本地会话持久化** — Session Entry Tree、分支、Context checkpoint 和元数据存储在本地 SQLite，重启后可继续
- ⚡ **流式响应** — 本地 Provider streaming，支持思维链（reasoning）展示
- ⌨️ **命令菜单** — 输入 `/` 快速切换模型、模式、主题、浏览历史会话

> **当前架构（ADR-0023、ADR-0024、ADR-0026）：** Stage 6.4 Provider Runtime、Stage 6.5 Local Session Authority，以及 Stage 6.5 semantic navigation/finalized-message follow-up 均已交付。CLI 的 Session、Provider 配置/凭证、Harness Context、cache/checkpoint、Model/Tool Runtime 均在本地运行；新 assistant 历史按 AgentLoop Model Step 持久化，不再为正常 Tool completion 新写 `message_update`，`/tree` 使用 semantic Navigation Projection 与 derived ToolUse。创建、列出、打开、继续和重启恢复不需要 Server、账户、`API_URL`、Cloudflare Worker 或 Railway。Stage 6.6 云同步/商业账户暂时暂停，Server/database 仅保留为 dormant future-cloud 代码。

---

## 🏗️ 项目架构

```
packages/cli + packages/harness
  ├── LocalSessionStore ───────► local SQLite Session authority
  ├── Local Runtime Store ─────► local SQLite execution/security facts
  ├── Provider Registry ────────► local provider/model configuration
  ├── CredentialStore ─────────► local encrypted credentials
  └── AgentLoop / Context ─────► direct LLM Provider APIs

MORE-MORE-CODE Cloud (dormant; Stage 6.6 paused)
  └── future account, entitlement, and optional sync/backup boundary
```

### 数据流

```
CLI 启动
    ↓
Agent Bootstrap
~/.more-more-code + <workspace>/.more-more-code
    ↓
Instruction Chain + Skill metadata + Tool Registry
    ↓
用户键盘输入
    ↓
[packages/cli]
    ↓
[packages/harness] Run Start
    ↓
Turn Start（一次 Model response + 该 response 的 Tools）
    ↓
Model Step → CLI LocalModelTransport → LLM Provider（本地进程发起）
    ↓
模型是否请求工具？
    ├─ 否 → Turn End → 无队列时 Run End
    └─ 是 → Tool Step(s) → Turn End
                         ↓
                 steering 优先消费？
                    ├─ 是 → 新 Turn(cause=steering)
                    └─ 否 → 新 Turn(cause=tool-continuation)

当 Run 原本将结束时，follow-up 队列会启动新的 Turn(cause=follow-up)。ExecutionEventStore 保存 coarse-grained Run/Turn/Step 执行事实；`subscribe()` 另外发出 `run_start/end`、`turn_start/end`、`step_start/update/end` 生命周期事件供 UI/扩展交互。Context Manager 会在每个 Model Step 前按预算生成 Context Projection。会话由 CLI 维护为可跳转、可分叉的 **Session Entry Tree v3**：user/assistant message、tool call/result、error、model/mode/config change、compaction 与 custom event 都可以成为持久化 Entry；UI、Context 和 Runtime State 分别从 active branch 做 projection。每个语义转换先由 LocalSessionStore durable commit，再向 UI/AgentLoop 暴露；Provider 请求和 Tool 执行均由本地 Harness 直接驱动，不经过 Server。
```

当前实现与 ADR-0023/0024 的架构边界为：

```text
CLI / Harness
  ├── Local Session Store        ← Session semantic authority（Stage 6.5 delivered）
  ├── Local Runtime Store        ← execution/security/recovery facts
  ├── Provider Registry          ← OpenAI / Anthropic / Google / DeepSeek / Custom
  ├── Credential Store           ← secrets stay local
  └── Model Provider APIs

          optional
             ↓
MORE-MORE-CODE Cloud
  ├── Account / Subscription / Entitlements
  └── Multi-device Session Sync / Backup
```

Cloud 当前已退出本地关键路径，不是 Model Step、Tool Step、Provider credential、Session 创建/继续或重启恢复的依赖。Stage 6.6 的同步与商业账户边界已暂停，恢复前需要显式产品重新批准。

---

## 📦 项目结构

```
MORE-MORE-CODE/
├── packages/
│   ├── cli/                    # 终端 UI 客户端
│   │   └── src/
│   │       ├── components/     # UI 组件（消息、输入框、状态栏等）
│   │       ├── providers/      # React Context（主题、对话框、键盘层等）
│   │       ├── screens/        # 路由页面（首页、新建会话、聊天）
│   │       ├── layouts/        # 布局组件
│   │       ├── hooks/          # 自定义 hooks（useChat 等）
│   │       ├── lib/            # Agent bootstrap / config / skills / tools / model runtime
│   │       ├── index.tsx       # 入口文件；先 bootstrap agent environment
│   │       └── theme.ts        # 9 种配色主题定义
│   │
│   ├── harness/                # Agent Harness Runtime
│   │   ├── src/
│   │   │   ├── agent-loop.ts   # 显式 Agent Loop；只执行并发出 lifecycle events
│   │   │   ├── execution-events.ts     # Run / Turn / Step execution event schema
│   │   │   ├── execution-store.ts      # ExecutionEventStore + in-memory store
│   │   │   ├── execution-projection.ts # Event replay → Run / Turn / Step
│   │   │   ├── lifecycle.ts     # Awaited Run/Turn/Step lifecycle stream
│   │   │   ├── context.ts      # Turn-aware Context Projection / Compaction
│   │   │   ├── token-budget.ts # Model profile token-counter contracts
│   │   │   ├── session-tree.ts # Session Entry Tree v3 + branch/projection/migration Runtime
│   │   │   ├── types.ts        # Run / Turn / Step projection 类型
│   │   │   └── index.ts
│   │   └── tests/              # Harness 确定性测试
│   │
│   ├── session-store/          # 本地 Session Entry Tree SQLite authority
│   │   ├── src/                # migrations + transactional store adapter
│   │   └── tests/              # persistence/topology/idempotency tests
│   │
│   ├── server/                 # dormant future cloud service
│   │   └── src/
│   │       ├── routes/         # sessions / auth / account APIs
│   │       ├── lib/            # 云服务相关基础设施
│   │       └── index.ts        # Hono 服务入口；不执行 Agent/Model
│   │
│   ├── database/               # dormant future cloud PostgreSQL boundary
│   │   ├── prisma/
│   │   │   └── schema.prisma   # 云 Session 数据库模型
│   │   └── src/
│   │       └── client.ts       # Prisma 客户端初始化
│   │
│   ├── runtime-store/          # 本地 Runtime Event SQLite 持久层
│   │   ├── prisma/             # 独立 schema 与 migration
│   │   └── src/                # SQLite EventStore adapter
│   │
│   └── shared/                 # 共享类型与校验
│       └── src/
│           ├── models.ts       # AI 模型定义与定价
│           └── schemas.ts      # Zod 校验 Schema（SSE 事件、消息等）
│
├── .more-more-code/            # 项目级 Agent 配置 / AGENTS.md / Skills
├── package.json                # Monorepo 根配置（workspaces）
├── tsconfig.base.json          # TypeScript 基础配置
└── bun.lock                    # Bun 锁文件
```

---

## 🚀 快速开始

### 前置要求

- [Bun](https://bun.sh/) >= 1.2.0

### 1. 克隆并安装依赖

```bash
git clone <repo-url>
cd more-more-code
bun install
```

### 2. 配置环境变量

Provider 凭据的首选入口是 CLI 内的 `/providers`：添加或启用 Provider，填写对应厂商的 API Key（Custom Provider 也可选择 Bearer/None），然后用 `/models` 选择默认模型。API Key 不会写入 Provider Registry JSON，而是交给本地 `CredentialStore` 保存。常见 Provider 环境变量仍可作为只读兼容 fallback。

CLI 不要求 `DATABASE_URL`、`API_URL`、Server、Clerk、Cloudflare 或 Railway。若需要显式指定本地数据库位置，可在项目根目录的 `.env` 中设置绝对 `file:` URL：

```bash
# 可选：本地 Session semantic store（默认 ~/.more-more-code/sessions/sessions.db）
LOCAL_SESSION_STORE_DATABASE_URL=file:///absolute/path/sessions.db

# 可选：本地 Runtime Event/Snapshot store
RUNTIME_STORE_DATABASE_URL=file:///absolute/path/runtime.db

# 可选兼容 fallback；更推荐在 /providers 中保存凭据
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
DEEPSEEK_API_KEY=sk-...
GOOGLE_GENERATIVE_AI_API_KEY=...
```

### 3. 启动本地 TUI

```bash
bun dev:cli
```

首次运行时，Session Store 和 Runtime Store 会自动创建并执行内嵌版本化 migrations；不需要先启动后端或初始化 PostgreSQL。`packages/server`、`packages/database` 仅为暂停中的未来云能力保留，不属于本地 CLI 的启动依赖。

---

## ⌨️ 使用指南

### 两种模式（Tab 切换）

| 模式 | 图标 | AI 可用工具 | 适用场景 |
|------|------|-------------|----------|
| **PLAN** | 🔍 | `readFile` `listDirectory` `glob` `grep` `loadSkill` | 代码审查、方案分析、问题排查 |
| **BUILD** | 🛠️ | 全部 native tools（含 `writeFile` `editFile` `bash`） | 实现功能、修改代码、执行命令 |

### 命令菜单（输入 `/`）

| 命令 | 功能 |
|------|------|
| `/new` | 新建会话 |
| `/agents` | 切换工作模式（PLAN / BUILD） |
| `/models` | 选择 AI 模型 |
| `/sessions` | 浏览历史会话 |
| `/tree` | 浏览当前 Session 的 semantic Navigation Tree Projection；隐藏 legacy update/bookkeeping，Tool Call/Result 合并为 ToolUse，跨分支时复用 Carry 策略 |
| `/jump` | 打开 Session Entry 跳转器，复用与 `/tree` 相同的 Branch Summary 决策 |
| `/parent` | 跳转到父 Entry；需要时执行同一套 Carry / No Carry / Cancel 流程 |
| `/root` | 跳转到 `session_start` 根 Entry；需要时执行同一套 Branch Summary 流程 |
| `/compact` | 手动压缩当前 active branch 的旧 Context；不创建伪 user message/Turn |
| `/providers` | 查看/管理本地 Provider、Custom OpenAI-compatible endpoint、认证状态与凭据 |
| `/settings` | 查看全局/项目 `.more-more-code` 配置、打开配置/AGENTS 文件并重新加载 |
| `/theme` | 切换配色主题 |
| `/exit` | 退出程序 |

### 快捷键

| 按键 | 功能 |
|------|------|
| `Tab` | 切换 PLAN / BUILD 模式 |
| `Esc` | 中断 AI 响应 / 关闭对话框 |
| `Ctrl+C` | 复制当前选区；1 秒内连续按两次退出程序 |
| `↑` `↓` | 导航历史消息 / 对话框列表 |

---

## 🤖 AI Provider 与模型

Stage 6.4 已将 Provider Runtime 从固定模型/provider switch 迁移为本地 Provider Registry + 动态 `ModelRef`。模型请求仍由 CLI 直接发往用户配置的 Provider；MORE-MORE-CODE Server 不代理模型流量，也不保存 Provider Secret。

Stage 6.4 的内置 Provider **固定为四个**：

| Provider | 首发 Auth | 说明 |
|---|---|---|
| **OpenAI** | API Key | Codex OAuth 需要受支持且有文档的 model-execution broker；当前不可用并从 UI 隐藏 |
| **Anthropic** | API Key | 首发明确不设计 Anthropic OAuth |
| **Google** | API Key | Google OAuth / Vertex ADC 后续单独研究 |
| **DeepSeek** | API Key | 本地直连 Provider |

另外提供 **Custom Provider V1**：用户可通过 `/providers` 添加多个稳定 `providerId` 的 OpenAI-compatible endpoint，配置 `baseURL`、模型 ID 与 `API Key | Bearer | None` auth。Mistral 不再属于 Stage 6.4+ 内置 Provider 面。

模型选择现在使用动态引用：

```ts
type ModelRef = {
  providerId: string;
  modelId: string;
};
```

内置/推荐模型目录只提供默认值、价格/Context metadata 与 UX 建议，而不是限制用户只能使用源码中硬编码的模型 ID。

Provider 非敏感配置位于用户级 `~/.more-more-code/providers.json`。API Key/Bearer 不写入该文件，而是通过独立 `CredentialStore` 保存；当前实现使用 AES-256-GCM 加密的本地文件适配器，并保留常见 Provider 环境变量作为只读兼容 fallback。该加密适配器主要消除明文配置/日志/序列化泄漏，不等同于 OS Keychain/Windows Credential Manager；后续可以在不改变 Provider Runtime 的情况下替换为平台原生 Secret Store。`/providers` 可执行 secret-safe connection test，展示解析后的最终请求 URL 并区分配置、凭据、协议、HTTP 和模型错误；测试使用最小请求和注入 transport，不代表真实外部 Provider E2E 已完成。

OpenAI `codex-oauth` 仍作为独立 Auth Broker seam 建模，但当前没有可用于原生 Provider execution 的受支持 broker，因此不可用选项会从 UI 隐藏并要求改用 API Key；实现不会读取或复制 `~/.codex` 私有 token 文件，也不会静默降级认证方式。Anthropic OAuth、Google OAuth/Vertex ADC 仍明确延后。

---

## 🎨 配色主题

内置 **9 种精心设计的主题**，通过 `/theme` 命令切换：

| 主题 | 风格 | 适用场景 |
|------|------|----------|
| 🌙 **Nightfox** (默认) | 深蓝夜狐 | 经典夜间开发 |
| ❄️ **Arctic Neon** | 冷蓝科技感 | AI / 开发者工具 |
| 🔮 **Violet Mirage** | 紫色幻想 | 二次元、神秘风 |
| 🔴 **Crimson Core** | 暗红机械 | 战斗、赛博终端 |
| 🌅 **Solar Ember** | 橙金暖色 | 复古、蒸汽朋克 |
| 🌿 **Emerald Grove** | 森林绿 | 自然、数据面板 |
| 💠 **Cyber Cyan** | 青色赛博 | 电子科技感 |
| 🌸 **Sakura Pulse** | 粉紫柔光 | 二次元、轻幻想 |
| 🏛️ **Slate Quantum** | 高级灰蓝 | 专业长时间编码 |

主题选择会持久化到 `~/.more-more-code/preferences.json`。

---

## 🧭 Agent Bootstrap 与 Skills

CLI 会在渲染 UI 和创建 Agent Run 之前完成一次 Agent Bootstrap：

```text
~/.agents/skills/<skill>/SKILL.md       # 兼容的用户级 Skill 来源

~/.more-more-code/
├── config.json
├── providers.json
├── credentials.enc.json
├── AGENTS.md
└── skills/<skill>/SKILL.md

<workspace>/.more-more-code/
├── config.json
├── AGENTS.md
└── skills/<skill>/SKILL.md
```

全局配置先加载，项目配置随后覆盖。`AGENTS.md` 按 **global → project** 组成 instruction chain，并进入每次 Model Step 的 system prompt。Skill discovery 的同名优先级为 **`~/.agents/skills < ~/.more-more-code/skills < project/.more-more-code/skills`**。Skills 与 Tools 是两个不同概念：启动时只发现 Skill 的 `name / description / path / scope`，完整 `SKILL.md` 只有在模型通过 native `loadSkill` 工具明确加载时才进入工作上下文，从而避免无关 Skill 占用 context window。

`/settings` 可查看当前解析出的全局/项目路径、兼容 `.agents` Skill 路径、instruction/skill/tool source 数量以及 Branch Summary 跳转策略，打开两级 `config.json` / `AGENTS.md` 或 `.agents/skills` 后可以执行 reload。当前配置格式为 JSON。项目/全局 Agent Config 可通过 `model: { providerId, modelId }` 选择默认模型，但 Provider account/endpoint 仍只存在于用户级 Registry，凭据只存在于 CredentialStore。`session.branchSummaryOnJump` 支持 `ask | always | never`，默认 `ask`。

权限策略同样从两级 `config.json` 按 **代码默认值 → global → project → 不可覆盖的 workspace containment** 生成。普通规则按声明顺序匹配，最后一个匹配规则生效；`capabilities`、`commands`、`paths`、`resources` 与 `scopes` 在同一规则中是 AND 约束，数组内部按 glob pattern 做 OR 匹配。路径 pattern 中 `*` 不跨目录、`**` 可跨目录；Windows 路径匹配不区分大小写。例如：

```json
{
  "permissions": {
    "default": "allow",
    "rules": [
      {
        "effect": "ask",
        "capabilities": ["filesystem.write"],
        "paths": ["secrets/**"],
        "scopes": ["workspace"]
      },
      {
        "effect": "deny",
        "capabilities": ["process.execute"],
        "commands": ["rm *", "git push*"],
        "scopes": ["workspace"]
      }
    ]
  }
}
```

支持的 effect 为 `allow | deny | ask`，scope 为 `workspace | outside-workspace | agent-config | external`。Tool Runtime 会先对注册 Tool 的全部 capability 执行最终策略：任一 `deny` 立即阻止 Tool；若没有 deny 但存在一个或多个 `ask`，这些 ask 会聚合为**同一个 Tool Call 的一次交互式审批**。CLI 弹窗只提供 `Allow once` 与 `Deny`：Allow 会在原 Tool Step 内继续原 executor，不要求模型重新发起 Tool Call；Deny、Escape/关闭弹窗、Run interrupt 或审批超时均不会执行 Tool。审批不会修改 global/project permission config，也不会产生永久授权。文件策略分类与 native executor 共享 canonical path resolver：既有 symlink/junction 会解析真实目标，新建文件会解析最近存在父目录；实际目标落在 workspace 外时始终拒绝，配置不能覆盖。该检查仍不能消除检查后链接被替换的 TOCTOU，也不等于 OS-level Sandbox。

Stage 6.3 在 Permission/Approval 之下新增独立的 **Process Sandbox** 执行层。`bash`、`grep` 等 native 子进程不再直接调用 `Bun.spawn`，而是统一经过 `ProcessSandbox`。Sandbox 配置同样按 global → project 覆盖：

```json
{
  "sandbox": {
    "mode": "auto",
    "network": "inherit",
    "environment": "safe",
    "envAllow": []
  }
}
```

`mode` 支持 `off | auto | required`：`off` 明确为未隔离的 direct execution；`auto` 优先使用当前平台可用的 OS provider；`required` 在没有 provider 时会在 spawn 前 fail-closed。`network=deny` 是硬约束，没有能执行网络隔离的 provider 时不会静默回退。`environment=safe` 是默认值，只向子进程投影 PATH/temp/locale/shell 等运行所需变量和 `envAllow` 中明确列出的变量，避免模型 Provider/API credentials 被 ambient inheritance 带入 shell；如确实需要完整宿主环境，可显式改为 `environment=inherit`。Linux 在发现 `bwrap` 时使用 Bubblewrap：host root 只读、workspace 可写、home 被遮蔽、`/tmp` 私有，并隔离 PID/IPC/UTS；`network=deny` 额外隔离网络。当前 Windows 尚无 AppContainer/restricted-token/Job-object adapter，因此 `auto` 会明确报告 direct fallback，不能把它称为 OS Sandbox；`required` 则拒绝执行。`/settings` 会显示实际 mode/provider/network/environment 状态及 fallback 原因。

## 🛠️ AI 工具系统

Tools 通过 Tool Registry 按来源区分为 **native** 与 **MCP extension source**。当前实际执行面仍以 native tools 为默认；MCP server 可以在 `.more-more-code/config.json` 中配置，但 MCP transport/auth/remote tool execution 将在后续阶段接入。

当前 native tools：

| 工具 | 作用 | 模式限制 |
|------|------|----------|
| `readFile` | 读取文件内容 | ✅ PLAN / ✅ BUILD |
| `listDirectory` | 列出目录内容 | ✅ PLAN / ✅ BUILD |
| `glob` | 按模式匹配文件 | ✅ PLAN / ✅ BUILD |
| `grep` | 正则搜索文件内容 | ✅ PLAN / ✅ BUILD |
| `loadSkill` | 按名称加载完整 `SKILL.md` | ✅ PLAN / ✅ BUILD |
| `writeFile` | 创建或覆写文件 | ❌ PLAN / ✅ BUILD |
| `editFile` | 精准替换文件内容 | ❌ PLAN / ✅ BUILD |
| `bash` | 执行 shell 命令 | ❌ PLAN / ✅ BUILD |

所有文件操作工具都带有**路径安全检查**，防止逃逸到项目目录之外；所有 native 子进程则统一经过 `ProcessSandbox`。路径检查、Permission Policy、Interactive Approval 与 Process Sandbox 是四个不同安全层，不互相冒充。

---

## 💾 数据持久化

### 数据库模型

本地 `packages/session-store` 是当前 Session semantic authority，默认数据库为 `~/.more-more-code/sessions/sessions.db`，也可用 `LOCAL_SESSION_STORE_DATABASE_URL` 指定绝对 `file:` URL。它保存 Session 元数据、root/active Entry identity、append-only **Session Entry Tree v3**、稳定序列、版本化 migrations，并以事务和幂等约束保护 topology。`create`、`load/open`、`list`、`commit`、`archive` 都在本地完成；Session 在提交成功前不会暴露给 UI，也不会触发 Provider 或 Tool 副作用。

Session state 直接保存 `entries[]`，每个 durable semantic event 自身就是带 `id / parentId / type` 的树节点，不再使用 v2 的 checkpoint `nodes[] + eventIds[] + events[]` 双层结构。消息只是 Session Entry 的一个子集；tool call/result、error、model/mode/config change、compaction、branch summary 与 custom event 也可以被持久化。新 assistant execution 以 AgentLoop `stepId` 作为 durable identity 来源：AI SDK 可跨 Tool continuation 复用同一个聚合 `UIMessage.id`，CLI 会按最后一个 `step-start` 边界只保存当前 Model Step 的 parts，因此不会把合法 continuation 误判成对旧 assistant Entry 的修改。显式导入 legacy linear/v1/v2/v3 快照的事务性/idempotent 命令尚未实现，但不阻断新建本地 Session；该 follow-up 不会在启动时抓取云端状态。

Harness 另有独立的 Run / Turn / Step `ExecutionEventStore`：AgentLoop 将执行事实记录为 append-only execution events，并通过 replay 投影出当前 `AgentRun`。Turn 的语义是“一次 Model response + 该 response 触发的 Tool executions”；工具结果继续调用模型时会开启新的 `tool-continuation` Turn。Harness 还提供 awaited lifecycle stream、`waitForIdle()`、steering/follow-up 队列与 Step progress。

Stage 6.0 新增并启用了独立的 `packages/runtime-store` SQLite 持久化边界。CLI 启动时会在 `~/.more-more-code/runtime/runtime.db` 创建并幂等执行内嵌版本化 migration；测试或高级部署可通过绝对 `file:` URL 的 `RUNTIME_STORE_DATABASE_URL` 覆盖位置。它与 `packages/session-store` 使用不同的 schema/client/migration：Session Store 保存语义会话，Runtime Store 只记录执行、安全、Context 与恢复事实。`packages/server` / `packages/database` 仍保留为暂停中的未来云能力，不参与本地 Session、Model、Tool 或 Context 关键路径。

每个 CLI Session 使用 durable `RuntimeSession` 作为 AgentLoop 的 `ExecutionEventStore`，并复用进程级 SQLite adapter 与 Projection Cache。执行、Tool、Context 与 session-open 事实继续采用严格白名单的 v1 payload；权限事实使用 v2 `permission.lifecycle requested | decided`，交互式审批使用独立的 v3 `approval.lifecycle requested | resolved | cancelled | timed_out`，并继续兼容旧 v1 decision。审批弹窗可以显示 process-local 的原始 command/path/resource value，但持久化 approval event 只包含 `approvalId`、ask requirement 的 capability/resource kind/scope 与 correlation ID；prompt、message、Tool input/output、原始命令/路径/文件内容或任意错误文本仍不会持久化。审批请求必须先 durable append 才会唤起 broker；用户 Allow 的终态也必须先 durable append，executor 才能开始。RuntimeSession 串行应用同一 Session 的 durable events；snapshot 是派生加速结构，snapshot 写入失败会保留已提交事件、记录进程内诊断并按 bounded backoff 重试，而不会把成功的 write-ahead append 误报为失败。重启时按最新 snapshot + 后续 events 恢复、预热 cache，并在 UI 报告未完成 Run/操作，但不会自动重放模型、工具或人类审批副作用。云端 revision/conflict sync 暂未启用，Stage 6.6 已暂停。

Harness 的纯派生 `projectSecurityAuditTimeline(sessionId, events)` 会从 session-scoped Runtime Event stream 重建安全审计时间线，而不把完整审计历史复制进 RuntimeSession snapshot。v2 permission request/decision 与 v3 approval transaction 都通过 Run/Turn/Step/Tool-call correlation 与 Tool terminal 校验；v1 decision 仍作为 `legacy` 条目保留。对新历史，`ask + approval allow` 可以合法进入 executor；approval deny/cancel/timeout 必须分别与 `denied/cancelled/timed_out` Tool terminal 一致。这里的 replay 仍是 **security lifecycle consistency replay**，不会从脱敏日志重新计算原始 command/path/resource 规则。命令 glob 仍只是应用层 policy，不是 shell parser 或 OS-level Sandbox。

### 会话恢复与分支

Session Entry Tree 中每个 Entry 都是一个可恢复的语义历史点。CLI 沿 `session_start → activeEntry` 路径分别投影 Message History、Navigation Tree 与 Runtime State；从旧 Entry 继续执行会创建新的 child branch，并保留 sibling branch。普通 `/tree` / `/jump` / `/parent` / `/root` 浏览本身不会创建 Entry。若目标路径会丢失 source-only 语义知识，统一导航控制器依据 `session.branchSummaryOnJump` 决定 `ask | always | never`：Carry 先跳到目标，再追加一个带精确 coverage/provenance 的 `branch_summary` child；No Carry 只改变导航状态；Cancel 保持原 source active。历史 v3 Session 中已有的不可变 `message_update` Entry 仍会在 Message Projection 中兼容 replay，但新 normal execution 不再写它；Tool terminal truth 由 canonical `tool_result` 投影回 UI/Provider，`/tree` 则始终折叠 legacy update。Legacy linear/v1/v2/v3 的显式事务性导入尚未交付；现有内存恢复/规范化能力不应被误解为已完成的本地迁移命令。

模型调用前会使用 `ModelContextProfile` 做预算，并先按 **core prompt → global instructions → project instructions → skill catalog → tool definitions → persisted checkpoint → history → retained tail → runtime continuation → current input** 的稳定→动态顺序建立 canonical Context。Active-path `branch_summary` 作为独立 historical Context record 参与这条顺序，不伪装成 UI chat Message；它的最大生成预算为 **min(4096 tokens, 有效输入预算 4%)**，源 delta 中的大 Tool Result 会先复用 Tool Result Working Set 裁剪。Skill/tool 集合使用确定性排序，PLAN/BUILD 分别生成 `ToolSetFingerprint` 与 `PromptPrefixFingerprint`。在历史 Compaction 之前，CLI 会先建立 **Tool Result Working Set**：完整 `tool_result` 仍保存在 append-only Session Tree 中，只有 model-facing clone 会按 `full / truncated / summary / reference` 做投影；fresh 结果优先保持完整，warm/cold 结果在预算压力下按 shell、test/build、search/grep、file-read、generic 策略裁剪，并保留 durable Session Entry reference。默认 Tool Working Set / 单结果 full threshold / reference target 分别占有效输入预算的 **25% / 6% / 0.6%**。最近 Turn 作为 retained tail 原子保留；Compaction 默认按有效输入预算的 **80% soft limit / 92% hard limit / 70% post-compaction target** 主动回收旧历史，而不是等到 provider 已经装不下。Cut point 只发生在完整 Context group/Turn 边界。CLI 在真正创建 checkpoint 时使用 LLM semantic reducer，把 `compactN + 新被压缩历史` 归约为包含 Current Goal / Current State / Decisions / Constraints / Artifacts / Failures and Lessons / Pending Work 的完整 replacement snapshot；若 reducer/provider 失败则回退到 bounded deterministic compactor。`/compact` 使用同一条 pipeline 并记录 `trigger=manual`，但它是“立即尝试压缩”而不是无条件 force：默认要求可压缩历史至少为 **max(2048 tokens, 输入预算 3%)**；已有 checkpoint 时至少新增 **2 个完整 Turn**；保守预计至少节省 **max(1024 tokens, 输入预算 2%)** 且达到 replacement source 的 **30%**。重复压缩判断基于 checkpoint 后的 Session 增量而不是时间 cooldown，并会排除上次 checkpoint 已 retained 的 record IDs；不满足条件时返回 `insufficient-history / recent-compaction / insufficient-gain` 等 typed no-op，不会调用 semantic reducer。真正执行时仍不绕过 retained/required records、原子 cut point、branch-local checkpoint 与 append-only persistence。生成的 `compaction` Entry 会额外记录 trigger、before/after token diagnostics、compacted-through 与 retained IDs；generic record coverage 可记录被吸收的 Branch Summary，从而在 checkpoint reuse 后避免重复注入。后续 Model Step 直接复用 active branch 最近 checkpoint，不会每一步重复生成等价 summary；旧 compaction、Branch Summary 与源 Session Entries 仍完整保留在 append-only Session Tree 中。OpenAI 模型显式走 `openai.responses(...)`，`OpenAIResponsesAdapter` 从 prefix fingerprint 派生 `promptCacheKey`，Vercel AI SDK 继续负责 streaming、tool integration 与 UI message normalization；`previous_response_id` 不作为 MORE-MORE-CODE Session authority。当前 provider token counter 仍是显式标记为 `estimated` 的适配器，Harness 已保留 exact tokenizer adapter 接口。

运行中的交互遵循 Turn-safe 语义：普通 **Enter** 排队 steering，**Alt+Enter** 排队 follow-up，**Escape** 请求中断当前 Run。steering 在当前 Turn 完成后、自动 tool continuation 之前消费；follow-up 只在 Run 原本将进入 idle 时消费。follow-up 仍保留在同一个 Run / Execution history 中，但会开启新的 loop-budget epoch，因此 `maxTurns` / `maxSteps` 从该 follow-up 边界重新计数，不继承上一段交互已经消耗的预算。

---

## 🧱 技术栈

| 层级 | 技术 |
|------|------|
| **运行时** | [Bun](https://bun.sh/) |
| **终端 UI** | [OpenTUI](https://github.com/opentui/core) + [React 19](https://react.dev/) |
| **路由** | [React Router 8](https://reactrouter.com/) |
| **后端框架** | [Hono](https://hono.dev/) |
| **AI SDK** | [Vercel AI SDK](https://sdk.vercel.ai/docs) (`ai` v7) + provider adapters；OpenAI 显式使用 Responses API |
| **数据库** | SQLite（本地 Session + Runtime）+ PostgreSQL（dormant future cloud）+ [Prisma](https://www.prisma.io/) v7 |
| **数据校验** | [Zod](https://zod.dev/) v4 |
| **错误监控** | [Sentry](https://sentry.io/) |

---

## 🔧 开发脚本

| 命令 | 说明 |
|------|------|
| `bun dev:cli` | 启动 TUI 客户端（watch 模式） |
| `bun run --cwd packages/session-store test` | 运行本地 Session Store migrations/事务/topology/idempotency 测试 |
| `bun run --cwd packages/runtime-store db:generate` | 重新生成本地 Runtime Store Prisma Client |
| `bun run --cwd packages/runtime-store db:validate` | 校验本地 Runtime Store Prisma schema |
| `bun run --cwd packages/runtime-store test` | 运行 SQLite Runtime Store 集成测试 |

`bun dev:server` 和 `packages/database` 只用于维护暂停中的未来云能力，不是本地 CLI 工作流的启动步骤。

---

## 📄 许可

ISC
