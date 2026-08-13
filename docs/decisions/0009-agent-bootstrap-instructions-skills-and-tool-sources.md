# ADR-0009: Bootstrap Agent Instructions, Skills, and Tool Sources from `.more-more-code`

## Status

Accepted

## Date

2026-08-13

## Context

The local-first Agent Loop, Session Entry Tree, Context Projection, and event-backed execution runtime are already separated, but the CLI previously began model execution with a hard-coded system prompt and hard-coded native tool contracts. It had no first-class initialization layer for user/project instructions, reusable skills, or future tool-extension sources.

A coding agent needs to know its workspace rules before the first Model Step, but loading every reusable workflow in full would waste context. Tools and skills also have different semantics: tools execute capabilities, while skills describe how the agent should approach a class of tasks. MCP belongs on the executable tool-extension side rather than inside the skill system.

## Decision

### `.more-more-code` is the agent configuration home

MORE-MORE-CODE uses two file-backed configuration scopes:

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

The CLI bootstraps these locations before rendering the application. Missing default files/directories are initialized without overwriting existing files.

Project configuration is applied after global configuration and therefore overrides overlapping global values. MCP server maps merge by server name so project configuration can add or replace individual server definitions.

JSON is used for the first configuration format to avoid adding a parser dependency during the bootstrap phase. The domain API is kept separate from the serialization format so a future format migration does not need to change AgentLoop or Context APIs.

### Instructions form an ordered chain

Bootstrap resolves instruction content in this order:

```text
global .more-more-code/AGENTS.md
    ↓
project .more-more-code/AGENTS.md
```

Both instruction bodies are composed into the model system prompt, with project instructions treated as the more specific source. Instructions are execution-environment context; they do not become Session Entries merely because they were loaded.

### Skills use progressive disclosure

Skills are discovered from three compatible sources, in increasing precedence order:

```text
~/.agents/skills/<name>/SKILL.md
~/.more-more-code/skills/<name>/SKILL.md
<workspace>/.more-more-code/skills/<name>/SKILL.md
```

`~/.agents/skills` is a read-only compatibility source so existing user-installed agent skills can be reused without copying them into MORE-MORE-CODE. MORE-MORE-CODE does not create or manage that directory.

At bootstrap, the Skill Registry reads only descriptor information required for discovery:

- `name`;
- `description`;
- source path;
- source scope (`agents`, `global`, or `project`).

The complete `SKILL.md` body is not preloaded into the system prompt. The system prompt exposes compact skill descriptors, and the read-only native `loadSkill` tool loads the complete skill only when the model determines that workflow is relevant.

Duplicate names resolve by specificity: `agents < global < project`. This lets MORE-MORE-CODE-specific user skills override shared `.agents` skills, while project skills remain the most specific source.

### Tools and skills remain separate domains

Tools are executable capabilities. Skills are reusable instructions/workflows.

The Tool Registry models sources explicitly:

```text
Tool Registry
├── native
│   ├── readFile
│   ├── listDirectory
│   ├── glob
│   ├── grep
│   ├── loadSkill
│   ├── writeFile
│   ├── editFile
│   └── bash
└── mcp
    └── configured server sources
```

Native tools remain the default executable surface and retain PLAN/BUILD restrictions. MCP server definitions can be stored in configuration and represented as extension sources, but this ADR does not add an MCP SDK, transport connection, authentication flow, or remote-tool execution path. Those concerns remain a later adapter layer.

### The system prompt is composed at Model Step time

The CLI system prompt is now a compact coding-agent prompt containing:

- core coding behavior and verification expectations;
- PLAN/BUILD constraints;
- the distinction between tools and skills;
- compact available-skill metadata;
- the resolved global/project instruction chain.

`LocalModelTransport` obtains executable tools from the current Tool Registry and obtains the current environment when building the prompt. Reloading settings therefore affects later Model Steps without moving bootstrap behavior into AgentLoop.

### `/settings` is the configuration entry point

`/settings` exposes the resolved global/project directories and registry summary. It provides actions to open global/project `config.json` and `AGENTS.md` files and to reload the environment after editing them.

The canonical configuration remains file-backed in this phase. A richer in-TUI settings editor can later call the same configuration service rather than defining a second settings store.

## Alternatives Considered

### Put project rules directly into the hard-coded system prompt

- Pros: minimal implementation.
- Cons: cannot support per-user/per-project behavior and requires code changes for repository conventions.
- Rejected: workspace instructions are configuration, not application source code.

### Load every `SKILL.md` in full at startup

- Pros: simple model access to workflows.
- Cons: context grows with the installed skill catalog even when most skills are irrelevant.
- Rejected: skill metadata should be discoverable while full instructions are loaded only when needed.

### Treat each skill as an AI SDK tool

- Pros: one registry abstraction.
- Cons: conflates executable capabilities with procedural guidance and makes MCP/tool permissions harder to reason about.
- Rejected: Tools and Skills have different runtime semantics.

### Implement a complete MCP client in the same phase

- Pros: immediately executes configured remote tools.
- Cons: introduces transport lifecycle, auth, tool-schema conversion, failure handling, and later permission/sandbox concerns before the bootstrap boundary is stable.
- Rejected: this phase establishes the extension boundary only.

## Consequences

- Every new CLI process has a deterministic Agent Bootstrap phase before any Session Model Step.
- User-global and workspace-specific rules can be changed without rebuilding the CLI.
- Skill catalogs scale without inserting every workflow body into the initial context.
- `loadSkill` is a read-only native tool and is available in both PLAN and BUILD modes.
- Native tools and configured MCP extension sources are visible through one Tool Registry without erasing their source distinction.
- MCP configuration is representable but not yet executable; an MCP transport adapter is still required later.
- WAL, crash recovery, permission enforcement, sandboxing, and Subagent runtime remain deferred.
