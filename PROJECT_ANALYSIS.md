# More More Code 项目核心分析

> 本文基于当前仓库代码整理，重点覆盖项目架构、核心数据结构、已实现功能、关键流程及当前边界，不展开逐文件说明。

## 1. 项目定位

More More Code 是一个运行在终端中的 AI 对话/编码助手原型。用户通过 TUI（Terminal UI）输入问题，CLI 调用本地 Hono 服务，服务端再请求不同厂商的大语言模型，并通过 SSE 将回答实时推送回终端；会话和消息使用 PostgreSQL 持久化。

项目当前已经形成完整的最小闭环：

1. 用户在终端输入首条消息；
2. 服务端创建会话并保存消息；
3. 服务端调用模型并流式返回回答；
4. CLI 实时渲染文本；
5. 回答完成或发生错误后保存到数据库；
6. 再次进入会话时加载历史消息，必要时自动恢复尚未回答的请求。

## 2. 技术栈与仓库结构

项目采用 Bun Workspaces 管理，根目录通过 `packages/*` 组织四个内部包。

| 包 | 主要技术 | 职责 |
| --- | --- | --- |
| `packages/cli` | React 19、OpenTUI、React Router、Hono RPC Client | 终端界面、页面导航、输入、消息展示、SSE 消费 |
| `packages/server` | Bun、Hono、AI SDK、Sentry | HTTP API、模型调用、流式响应、错误与日志观测 |
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
  │  Hono 类型安全客户端 / HTTP
  ▼
Hono Server
  ├── /sessions：会话查询与创建
  ├── /chat：模型请求与 SSE 流
  ├── AI SDK：统一模型调用
  └── Sentry：日志、异常、指标
  │
  ▼
Prisma Client
  │
  ▼
PostgreSQL
```

共享包位于 CLI、Server 之间，统一模型 ID 和流式事件的类型/校验规则；数据库包则统一导出 Prisma Client 和枚举。

## 4. 核心数据结构

### 4.1 Session（会话）

`Session` 表示一段独立对话。

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `id` | String / CUID | 会话主键 |
| `userId` | String | 用户标识；当前固定为 `mock-user` |
| `title` | String | 会话标题，目前取首条消息前 100 个字符 |
| `cwd` | String? | 创建会话时 CLI 所在工作目录 |
| `createdAt` | DateTime | 创建时间 |
| `updatedAt` | DateTime | 自动更新时间 |
| `messages` | Message[] | 一对多关联的消息列表 |

`userId` 建有索引，但目前尚未实现真实登录、用户隔离或鉴权。

### 4.2 Message（消息）

`Message` 保存用户输入、模型回答或模型调用错误。

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

服务端提供：

| 方法 | 路径 | 功能 |
| --- | --- | --- |
| GET | `/sessions/` | 按创建时间倒序返回会话摘要 |
| GET | `/sessions/:id` | 返回会话及按时间正序排列的全部消息 |
| POST | `/sessions/` | 创建会话，可同时创建首条用户消息 |

创建接口使用 Zod 校验标题、工作目录、消息角色、模式和模型 ID。

### 5.4 AI 流式聊天

聊天接口包含两种入口：

| 方法 | 路径 | 功能 |
| --- | --- | --- |
| POST | `/chat/:sessionId` | 保存新用户消息并生成回答 |
| POST | `/chat/:sessionId/resume` | 为末尾尚无回答的用户消息恢复生成 |

普通聊天仅取此前最近 10 条消息，再附加当前用户消息组成模型上下文。数据库保留完整历史，但每次模型调用不会发送全部历史，可限制上下文长度和调用成本。

### 5.5 流式中断与恢复

CLI 使用 `AbortController` 管理当前请求，页面卸载时会中止流。服务端检测客户端断开，并尝试保存已生成的部分文本。

如果会话加载后最后一条是用户消息，CLI 会自动请求 `/resume`。服务端通过内存中的 `activeResumeSessionIds` 防止同一进程内同一会话被重复恢复。

### 5.6 多模型抽象

共享包维护模型 ID、厂商和输入/输出 Token 单价。当前清单涉及：

- OpenAI；
- Anthropic；
- Mistral；
- Google；
- DeepSeek。

服务端通过 AI SDK 将模型 ID 解析为具体 Provider 实例。默认模型为 `deepseek-v4-flash`。

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
  → 跳转 /sessions/new
  → POST /sessions，保存 Session + 首条 USER Message
  → 跳转 /sessions/:id
  → 检测最后一条为 USER
  → POST /chat/:id/resume
  → AI SDK 生成回答
  → SSE 实时推送文本
  → 保存 ASSISTANT Message
  → CLI 将流式内容转为正式消息
```

这里采用“先持久化首条消息，再恢复生成”的方式。即使创建会话后 CLI 退出，重新进入仍有机会继续生成回答。

### 6.2 会话内继续提问

```text
用户提交文本
  → CLI 立即乐观添加用户消息
  → POST /chat/:id
  → 服务端持久化 USER Message
  → 读取最近 10 条历史并调用模型
  → SSE 推送 text-delta
  → CLI 聚合并实时渲染
  → done 后保存并展示完整 ASSISTANT Message
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

以下内容是基于当前代码确认的限制或不一致：

1. **真实用户系统尚未实现**  
   所有会话都写入固定的 `mock-user`，登录、登出、计费和使用量命令只是界面占位。

2. **模型清单与实际 Provider 支持不一致**  
   Mistral、Google 模型能通过共享层校验，但服务端无法解析，调用时会失败。

3. **Plan 模式和模型选择尚未接入交互**  
   数据库及 UI 已定义 Build/Plan，模型清单也已存在，但当前提交固定使用 `BUILD` 和默认 DeepSeek 模型。

4. **工具调用与推理流仅完成协议设计**  
   Schema 已定义 reasoning、tool-call、tool-result，但服务端只处理文本流，CLI 也只渲染文本。

5. **中断消息持久化角色疑似错误**  
   服务端保存被中断的模型输出时使用了 `USER` 角色，而这段文本实际是助手已生成的部分回答，应重点检查是否应为 `ASSISTANT`。

6. **耗时单位存在不一致风险**  
   正常消息入库存储的是四舍五入后的秒数，但加载历史时直接交给 `pretty-ms`，该库通常按毫秒解释；实时 `done` 事件则传递毫秒。历史展示与实时展示可能出现不同单位结果。

7. **断线恢复锁只在单进程内有效**  
   `activeResumeSessionIds` 是内存集合。多实例部署时无法阻止两个服务实例同时恢复同一会话。

8. **会话列表接口尚无完整 UI**  
   后端已经支持获取会话列表，但 `/sessions` 命令目前只显示提示，没有历史会话浏览页面。

9. **缺少项目级测试与正式说明**  
   当前未发现业务测试；README 只有项目标题，环境变量、数据库迁移、Provider Key 和启动顺序尚未文档化。

10. **可观测性配置偏开发态**  
    Sentry DSN 直接写在代码中，Trace 采样率为 100%，并保留公开的测试异常路由；上线前应改为环境配置并按环境调整。

11. **当前工作区包含未提交改动**  
    本文反映的是当前工作树代码，而不只是最近一次提交中的稳定状态。

## 9. 项目现阶段总结

当前项目不是单纯的 TUI 演示，而是已经具备“终端交互—API—模型流—数据库持久化—错误观测”完整纵向链路的 AI 聊天原型。架构分包合理，共享契约、类型安全客户端、SSE 流和会话恢复为后续扩展打下了基础。

现阶段最核心的已完成能力是：

- 终端中的多轮对话体验；
- 会话与消息持久化；
- AI 文本流式输出；
- 中断和自动恢复机制；
- 多 Provider 的初步抽象；
- 主题、命令菜单和基础可观测性。

下一阶段若继续完善，优先级较高的方向应是：修正中断消息和耗时单位问题、统一模型清单与实际 Provider、实现模型/模式切换、补齐历史会话浏览，然后再扩展工具调用、真实认证和计费功能。
