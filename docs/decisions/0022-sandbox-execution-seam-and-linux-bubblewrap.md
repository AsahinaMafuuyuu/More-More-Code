# ADR-0022: Sandbox Execution Seam and Linux Bubblewrap Adapter

## Status

Accepted

## Date

2026-08-23

## Context

Stages 6.0 and 6.2 established application-level Tool security: canonical workspace containment, `allow | deny | ask` Permission Policy, one-time interactive approval, write-ahead redacted Runtime Events, and security lifecycle replay. Those controls answer whether an operation may execute, but they do not constrain what an already-authorized subprocess can do after it starts. A permitted shell command can still inherit provider credentials, access host paths outside the workspace, open the network, or create descendant processes.

The native `bash` and `grep` Tools also created processes directly. Leaving OS-specific process creation inside individual Tools would duplicate cancellation, environment, provider discovery, and platform fallback behavior as new process-backed Tools are added.

The primary development host is Windows, where the current environment does not expose a Bubblewrap/nsjail/firejail-style native isolation provider. Treating a sanitized environment or workspace `cwd` as a Sandbox would therefore overstate the delivered security properties.

## Decision

Introduce one CLI `ProcessSandbox` module below native Tool execution. Every native child process crosses this seam; `local-tools.ts` no longer creates subprocesses directly.

`ProcessSandbox` owns:

- provider discovery and an explicit `direct | bubblewrap | unavailable` status;
- launch-plan construction and the only CLI `Bun.spawn` call;
- validation that subprocess `cwd` remains within an explicit writable `workspaceRoot`;
- child environment projection;
- fail-open/fail-closed selection from the resolved Sandbox configuration.

Agent configuration gains a layered global -> project Sandbox policy:

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

Semantics are:

- `mode=off`: use direct execution. It is explicitly **not isolated**.
- `mode=auto`: use an OS provider when supported. Direct fallback is allowed only if doing so does not discard a requested hard restriction.
- `mode=required`: no provider means no spawn; execution fails closed.
- `network=deny`: requires a provider that can enforce network isolation. `auto` does not silently downgrade it to inherited networking.
- `environment=safe`: child processes receive a bounded runtime/path/temp/locale allowlist plus exact variable names in `envAllow`. Ambient provider/API credentials are not inherited by default.
- `environment=inherit`: explicitly restores the complete parent process environment.

The Sandbox config object is strict. Unknown fields are rejected so a typo in a security setting cannot be silently stripped and interpreted as a weaker default.

On Linux, the first OS adapter is Bubblewrap when `bwrap` is discoverable. Its launch plan uses:

- read-only bind of the host root;
- read-write bind of the canonical workspace root;
- a `cwd` constrained to that workspace;
- private `/tmp` and a masked home view;
- PID/IPC/UTS namespace isolation and a new session;
- `--unshare-net` when `network=deny`.

This profile protects host writes outside the workspace and can isolate networking, but it is not described as full host-read confidentiality: the read-only root intentionally keeps ordinary system executables/libraries available, while the user's home is masked. Stronger filesystem visibility profiles can be introduced later without changing native Tool callers because the isolation logic is behind the `ProcessSandbox` interface.

`bash` retains its existing direct/MSYS cancellation-file process-group bridge. Under Bubblewrap, cancellation terminates the Sandbox supervisor; the private PID namespace owns the isolated descendant tree. `grep` and `bash` now share the same environment and Sandbox policy.

## Alternatives Considered

### Treat workspace `cwd` and canonical path checks as the Sandbox

Rejected. `cwd` is only a default directory and Permission Policy is application-level authorization. Neither prevents an allowed subprocess from opening another path, inheriting secrets, or using the network.

### Force Docker or WSL as the default Windows Sandbox

Rejected for this Stage. Containerizing every local shell invocation changes filesystem paths, installed-tool visibility, startup behavior, Git credentials, and developer environment semantics. Docker/WSL may become opt-in adapters later, but they are not a transparent replacement for native Windows process execution.

### Add platform logic directly to `bash` and `grep`

Rejected because provider discovery, environment projection, hard-restriction fallback, and launch semantics would be duplicated across Tools. A single deep module provides higher leverage and makes new process-backed native Tools inherit the same policy automatically.

### Silently fall back when `required` or `network=deny` cannot be enforced

Rejected because this would turn a security control into a capability hint. Hard restrictions fail before child-process creation.

## Consequences

- Native subprocess creation has one auditable seam and one platform/provider decision point.
- Safe child environments reduce accidental credential exposure even on hosts without an OS Sandbox provider.
- Linux hosts with Bubblewrap can obtain OS-enforced workspace-write/process isolation and optional network isolation.
- `/settings` reports the effective Sandbox mode/provider/network/environment state and explains direct fallback or unavailability.
- Windows currently reports direct fallback in `auto`, and `required` fails closed. This delivery does **not** claim Windows OS-level filesystem/network isolation.
- A future Windows AppContainer/restricted-token/Job-object adapter, macOS adapter, or optional container adapter can be added behind the existing seam.
- Permission Policy, Approval Broker, Tool Runtime, and Process Sandbox remain separate modules: authorization and human consent do not become OS execution policy.
