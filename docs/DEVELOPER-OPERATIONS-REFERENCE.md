# Developer Operations Reference

Run commands from the repository root unless stated otherwise.

## Development/build/test

| Command | Purpose |
| --- | --- |
| `bun install` | Install monorepo dependencies. |
| `bun run dev:cli` | Start the CLI/TUI once. Entry: `packages/cli/src/index.tsx`. |
| `bun run dev:cli:watch` | Start CLI in Bun watch mode. |
| `bun run build:cli` | Build `@more-more-code/cli`. |
| `bun run test:harness` | Run Harness package tests. |
| `bun run tui:soak` | OpenTUI native stability soak. Entry: `packages/cli/src/dev/tui-stability-soak.tsx`. |
| `bun run tui:stress` | OpenTUI stress suite. Entry: `packages/cli/src/dev/tui-stability-stress-suite.ts`. |
| `bun run dev:server` | Start server with hot reload. Entry: `packages/server/src/index.ts`. |
| `bun run link:cli` | Build then `bun link` the CLI package. |

Package-specific checks can be run with `bun run --filter <package> test`, `typecheck`, or `build` where the package exposes those scripts.

## In-CLI commands

Command metadata lives in `packages/cli/src/components/command-menu/commands.tsx`; execution routing lives in `packages/cli/src/app/session/session-command-router.ts`.

| Command | Main path/function |
| --- | --- |
| `/new` | `SessionCommandRouter` -> new-session navigation. |
| `/models` | model selection dialog; model resolution under `packages/cli/src/lib/models.ts`. |
| `/providers` | provider/credential dialog; provider code under `provider-registry.ts`, `provider-auth.ts`, `provider-endpoints.ts`. |
| `/sessions` | local session browser. |
| `/tree`, `/jump`, `/parent`, `/root` | Session Tree navigation; `session-navigation-projection.ts` and controller navigation methods. |
| `/compact` | `SessionController.compact()` -> `LocalModelTransport.compactContext()` -> Harness `ContextManager.compactManually()`. |
| `/config`, `/settings` | global/project agent settings UI; config implementation begins at `packages/cli/src/lib/agent-config.ts`. |
| `/theme` | theme dialog. |
| `/exit` | centralized shutdown path. |

## Context/provider debugging map

- Context budget/profile: `packages/cli/src/lib/model-context-profile.ts`
- Context projection + automatic/manual compaction: `packages/cli/src/lib/local-model-transport.ts`, `packages/harness/src/context.ts`
- Semantic compactor: `packages/cli/src/lib/context-compactor.ts`
- Tool-result working-set projection: `packages/cli/src/lib/tool-result-pruning.ts`
- Chat message -> provider-neutral request compilation: `packages/cli/src/lib/native-message-compiler.ts`
- Native provider HTTP/SSE adapters and DeepSeek cache usage parsing: `packages/cli/src/lib/native-provider-executor.ts`
- Stable prompt-prefix identity: `packages/cli/src/lib/cache-identity.ts`, `packages/cli/src/lib/provider-runtime.ts`
- Runtime context/usage persistence: `packages/cli/src/app/session/session-controller.ts`

## UI performance map

- Streaming in-memory chat reducer: `packages/cli/src/lib/local-chat-runtime.ts`
- Conversation projection: `packages/cli/src/ui/session/projections/session-ui-projections.ts`
- Round grouping: `packages/cli/src/lib/conversation-rounds.ts`
- Tool-use projection: `packages/cli/src/lib/tool-use-projection.ts`
- Conversation rendering: `packages/cli/src/ui/session/surfaces/conversation-surface.tsx`
- Scroll container: `packages/cli/src/ui/session/workspace/conversation-pane.tsx`
- UI projection store/commit scheduler: `packages/cli/src/ui/session/store/session-ui-store.ts`, `packages/cli/src/ui/session/runtime/session-runtime-bridge.tsx`

## Local database inspection

The SQLite files are user data. Prefer read-only inspection and never mutate them while the CLI is running.

```powershell
bun -e "import { Database } from 'bun:sqlite'; const db=new Database(process.env.USERPROFILE+'/.more-more-code/sessions/sessions.db',{readonly:true}); console.log(db.query('select id,title,updatedAt from LocalSession order by updatedAt desc limit 10').all()); db.close();"
```
