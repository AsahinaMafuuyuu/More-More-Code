# Domain Glossary

## Session

A durable history of one agent conversation/workflow, including conversational content, semantic runtime events, state changes, context-control events, and branches.

## Session Entry

One durable semantic fact in a Session. A Session Entry is the atomic node of Session history. Messages are one kind of Session Entry; model changes, tool calls/results, errors, compaction, and custom events are also Session Entries.

## Session Entry Tree

The branchable history formed by Session Entries and their parent relationships. Selecting an Entry chooses one historical branch and one continuation point without deleting sibling futures.

## Active Entry

The current continuation cursor of a Session Entry Tree. New durable Session facts become descendants of the Active Entry.

## Branch

One root-to-entry history path through a Session Entry Tree. Branches may share an unchanged historical prefix and diverge after any earlier Entry.

## Message Projection

The conversational message history derived from a Session branch. Non-message Session Entries remain part of Session history even when they are absent from this projection.

## Runtime State Projection

The effective agent/model configuration derived from state-changing Session Entries on a branch, such as model, mode, or other configuration changes.

## Context Projection

The bounded, provider-independent input view selected for a particular model invocation. Canonical Context is compiled from stable to dynamic content so model-visible prefixes remain reusable; projection may summarize or omit old history for model limits without deleting the underlying Session history.

## Context Stability

A provider-independent classification of Context Records as stable, checkpoint, history, retained, or dynamic. It controls canonical ordering but does not encode provider-specific cache fields.

## Compaction Entry

A durable record that a context compaction occurred, including the resulting summary and the history range it represented. The latest Compaction Entry on the active branch also acts as the persisted Context checkpoint for later Model Steps; it does not erase the original Session Entries.

## ToolSet Fingerprint

A deterministic identity of the model-visible Tool contracts for one mode, derived from tool name, source, description, input schema, and mode availability. PLAN and BUILD therefore form different cache families when their Tool Sets differ.

## Prompt Prefix Fingerprint

A deterministic identity of the stable model prefix, derived from provider/model/mode, system prompt version, global/project instruction hashes, Skill catalog hash, and ToolSet fingerprint. Provider adapters may derive provider-specific cache keys from it.

## Provider Runtime

The boundary that translates canonical model input and prefix identity into provider-specific execution configuration and diagnostics. OpenAI-specific Responses/cache behavior belongs here rather than in Session or Context semantics.

## Execution Event

A runtime lifecycle fact about Run, Turn, or Step execution. Execution Events describe how the runtime executed; Session Entries describe the durable semantic history of the Session. They are related but distinct histories.

## Agent Environment

The resolved process-local coding-agent environment created before Session execution. It combines global/project configuration, the ordered Instruction Chain, the Skill Registry, and Tool Registry sources. It is execution context, not Session history.

## Instruction Chain

The ordered instructions loaded from `~/.more-more-code/AGENTS.md` and `<workspace>/.more-more-code/AGENTS.md`. Project instructions are more specific than global instructions and are composed into the model system prompt.

## Skill

A reusable workflow/instruction package stored as `.more-more-code/skills/<name>/SKILL.md`. Skills are not executable tools. Bootstrap loads only descriptor metadata; the full skill body is loaded on demand through `loadSkill`.

## Tool Source

The origin of executable tool capabilities. `native` is the built-in default source; `mcp` represents externally configured Model Context Protocol extension sources. MCP transport execution is not implemented yet.
