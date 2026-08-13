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

The bounded input view selected for a particular model invocation. Context Projection may summarize or omit old history for model limits without deleting the underlying Session history.

## Compaction Entry

A durable record that a context compaction occurred, including the resulting summary and the history range it represented. It does not erase the original Session Entries.

## Execution Event

A runtime lifecycle fact about Run, Turn, or Step execution. Execution Events describe how the runtime executed; Session Entries describe the durable semantic history of the Session. They are related but distinct histories.
