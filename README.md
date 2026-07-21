# MORE MORE CODE

> **终端里的 AI 编程助手** — 在终端中与 AI 对话，让 AI 直接操作你的代码。

一款基于 **Bun + TypeScript Monorepo** 构建的终端 TUI（Text-based UI）应用。它让你在终端中与 GPT / Claude / DeepSeek 等 AI 模型交互，AI 可以读取、编辑你的项目文件，执行 shell 命令，真正辅助你写代码。

---

## ✨ 功能特性

- 🖥️ **全终端 TUI 界面** — 基于 OpenTUI + React，无需离开终端
- 🤖 **多模型支持** — 支持 OpenAI、Anthropic、DeepSeek 等多个 AI 模型，随时切换
- 🔀 **双工作模式** — `PLAN`（只读分析）和 `BUILD`（完整读写），Tab 键一键切换
- 🛠️ **AI 工具调用** — AI 可直接读文件、写文件、编辑文件、搜索代码、执行命令
- 🎨 **9 种配色主题** — 从 Nightfox 到 Sakura Pulse，满足不同审美
- 📜 **对话持久化** — 所有会话存储在 PostgreSQL，随时回溯和恢复
- ⚡ **流式响应** — SSE 实时流式输出，支持思维链（reasoning）展示
- ⌨️ **命令菜单** — 输入 `/` 快速切换模型、模式、主题、浏览历史会话

---

## 🏗️ 项目架构

```
┌─────────────────────────────────────────────────────────┐
│                   MORE MORE CODE                         │
│                                                          │
│  ┌──────────────┐     ┌──────────────┐                   │
│  │   packages/   │     │   packages/   │                 │
│  │     cli       │◄────│    server     │                 │
│  │  (OpenTUI)    │ HTTP│   (Hono)     │                 │
│  │               │  SSE│              │                 │
│  └──────────────┘     └──────┬───────┘                   │
│                              │                           │
│                     ┌────────▼────────┐                  │
│                     │  packages/      │                  │
│                     │  database       │                  │
│                     │  (Prisma+PG)    │                  │
│                     └─────────────────┘                  │
│                                                          │
│  ┌─────────────────────────────────────────────┐         │
│  │         packages/shared (Zod 类型)           │         │
│  └─────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────┘
```

### 数据流

```
用户键盘输入
    ↓
[packages/cli] OpenTUI React 渲染 → HTTP 请求（Hono Client）
    ↓
[packages/server] Hono API 路由 (session CRUD / chat SSE)
    ↓
[Vercel AI SDK] → GPT / Claude / DeepSeek 等模型
    ↓
[AI 工具调用] → 读/写/编辑文件、执行 bash 命令
    ↓
结果通过 SSE 流式返回 CLI
    ↓
[packages/database] PostgreSQL (Prisma) 持久化会话与消息
```

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
│   │       ├── index.tsx       # 入口文件
│   │       └── theme.ts        # 9 种配色主题定义
│   │
│   ├── server/                 # AI 聊天后端
│   │   └── src/
│   │       ├── routes/         # API 路由（sessions、chat）
│   │       ├── tools/          # AI 工具实现（readFile、writeFile、bash 等）
│   │       ├── lib/            # 工具函数
│   │       └── index.ts        # Hono 服务入口
│   │
│   ├── database/               # 数据持久层
│   │   ├── prisma/
│   │   │   └── schema.prisma   # 数据库模型定义
│   │   └── src/
│   │       └── client.ts       # Prisma 客户端初始化
│   │
│   └── shared/                 # 共享类型与校验
│       └── src/
│           ├── models.ts       # AI 模型定义与定价
│           └── schemas.ts      # Zod 校验 Schema（SSE 事件、消息等）
│
├── package.json                # Monorepo 根配置（workspaces）
├── tsconfig.base.json          # TypeScript 基础配置
└── bun.lock                    # Bun 锁文件
```

---

## 🚀 快速开始

### 前置要求

- [Bun](https://bun.sh/) >= 1.2.0
- [PostgreSQL](https://www.postgresql.org/) 数据库实例（本地或远程）

### 1. 克隆并安装依赖

```bash
git clone <repo-url>
cd more-more-code
bun install
```

### 2. 配置环境变量

在项目根目录创建 `.env` 文件：

```bash
# 数据库连接（必须）
DATABASE_URL=postgresql://user:password@localhost:5432/moremorcode

# AI API Keys（至少配置一个用到的模型）
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
DEEPSEEK_API_KEY=sk-...
MISTRAL_API_KEY=...
GOOGLE_GENERATIVE_AI_API_KEY=...
```

### 3. 初始化数据库

```bash
cd packages/database
bunx prisma db push    # 创建表结构
bunx prisma generate   # 生成 Prisma Client
cd ../..
```

### 4. 启动服务

**Terminal 1 — 启动后端：**

```bash
bun dev:server
# 默认监听 http://localhost:3002
```

**Terminal 2 — 启动前端 TUI：**

```bash
bun dev:cli
```

---

## ⌨️ 使用指南

### 两种模式（Tab 切换）

| 模式 | 图标 | AI 可用工具 | 适用场景 |
|------|------|-------------|----------|
| **PLAN** | 🔍 | `readFile` `listDirectory` `glob` `grep` | 代码审查、方案分析、问题排查 |
| **BUILD** | 🛠️ | 全部工具（含 `writeFile` `editFile` `bash`） | 实现功能、修改代码、执行命令 |

### 命令菜单（输入 `/`）

| 命令 | 功能 |
|------|------|
| `/new` | 新建会话 |
| `/agents` | 切换工作模式（PLAN / BUILD） |
| `/models` | 选择 AI 模型 |
| `/sessions` | 浏览历史会话 |
| `/theme` | 切换配色主题 |
| `/exit` | 退出程序 |

### 快捷键

| 按键 | 功能 |
|------|------|
| `Tab` | 切换 PLAN / BUILD 模式 |
| `Esc` | 中断 AI 响应 / 关闭对话框 |
| `Ctrl+C` | 退出程序 |
| `↑` `↓` | 导航历史消息 / 对话框列表 |

---

## 🤖 AI 模型支持

| 提供商 | 模型 ID | 特性 | 输入价格 ($/百万token) | 输出价格 ($/百万token) |
|--------|---------|------|----------------------|----------------------|
| **OpenAI** | `gpt-5.5` | 标准版 | $5.00 | $30.00 |
| | `gpt-5.4-mini` | 轻量快速 | $0.75 | $4.50 |
| **Anthropic** | `claude-sonnet-5` | 平衡性能 | $2.00 | $10.00 |
| | `claude-haiku-4-5` | 快速轻量 | $1.00 | $5.00 |
| **DeepSeek** | `deepseek-v4-flash` 🏆 **默认** | 快速高性价比 | $0.14 | $0.28 |
| | `deepseek-v4-pro` | 深度推理（带思考机制） | $0.435 | $0.87 |
| **Mistral** | `mistral-medium-latest` | 中型模型 | $1.50 | $7.50 |
| | `mistral-small-latest` | 小型轻量 | $0.15 | $0.60 |
| **Google** | `gemini-2.5-flash` | 多模态 | $0.30 | $2.50 |
| | `gemini-2.5-flash-lite` | 极致性价比 | $0.10 | $0.40 |

> 💡 通过 `/models` 命令或在输入框中随时切换模型。

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

## 🛠️ AI 工具系统

AI 在 BUILD 模式下可以调用的工具（PLAN 模式仅前 4 个只读工具）：

| 工具 | 作用 | 模式限制 |
|------|------|----------|
| `readFile` | 读取文件内容 | ✅ PLAN / ✅ BUILD |
| `listDirectory` | 列出目录内容 | ✅ PLAN / ✅ BUILD |
| `glob` | 按模式匹配文件 | ✅ PLAN / ✅ BUILD |
| `grep` | 正则搜索文件内容 | ✅ PLAN / ✅ BUILD |
| `writeFile` | 创建或覆写文件 | ❌ PLAN / ✅ BUILD |
| `editFile` | 精准替换文件内容 | ❌ PLAN / ✅ BUILD |
| `bash` | 执行 shell 命令 | ❌ PLAN / ✅ BUILD |

所有文件操作工具都带有**路径安全检查**，防止逃逸到项目目录之外。

---

## 💾 数据持久化

### 数据库模型

- **Session**（会话）：`id` / `userId` / `title` / `cwd`（工作目录）/ `createdAt`
- **Message**（消息）：`id` / `sessionId` / `role`(USER|ASSISTANT|ERROR) / `status`(COMPLETE|INTERRUPTED) / `content` / `parts`(JSON) / `mode`(PLAN|BUILD) / `model` / `duration`

### 消息恢复

如果会话的最后一条是用户消息且没有 AI 回复（如意外中断），重新进入会话会自动恢复（`resume`），AI 会收到之前的上下文继续处理。

---

## 🧱 技术栈

| 层级 | 技术 |
|------|------|
| **运行时** | [Bun](https://bun.sh/) |
| **终端 UI** | [OpenTUI](https://github.com/opentui/core) + [React 19](https://react.dev/) |
| **路由** | [React Router 8](https://reactrouter.com/) |
| **后端框架** | [Hono](https://hono.dev/) |
| **AI SDK** | [Vercel AI SDK](https://sdk.vercel.ai/docs) (`ai` v7) |
| **数据库** | PostgreSQL + [Prisma](https://www.prisma.io/) v7 |
| **数据校验** | [Zod](https://zod.dev/) v4 |
| **错误监控** | [Sentry](https://sentry.io/) |

---

## 🔧 开发脚本

| 命令 | 说明 |
|------|------|
| `bun dev:server` | 启动后端开发服务（hot reload） |
| `bun dev:cli` | 启动 TUI 客户端（watch 模式） |
| `bun run --cwd packages/database db:generate` | 重新生成 Prisma Client |

---

## 📄 许可

ISC
