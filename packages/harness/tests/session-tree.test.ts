import { describe, expect, test } from "bun:test";
import {
  appendSessionTreeNode,
  createSessionTree,
  getActiveSessionTreeNode,
  getParentSessionTreeNode,
  jumpToSessionTreeNode,
  restoreSessionTree,
} from "../src";

function deterministicOptions() {
  let id = 0;
  let now = 100;
  return {
    createId: () => `node-${++id}`,
    now: () => ++now,
  };
}

describe("session tree", () => {
  test("creates a root and appends resumable turn nodes", () => {
    const options = deterministicOptions();
    const root = createSessionTree<string>([], options);
    const next = appendSessionTreeNode(root, ["u1", "a1"], { runId: "run-1" }, options);

    expect(root.rootNodeId).toBe("node-1");
    expect(next.nodes).toHaveLength(2);
    expect(getActiveSessionTreeNode(next).messages).toEqual(["u1", "a1"]);
    expect(getActiveSessionTreeNode(next).parentId).toBe(root.rootNodeId);
  });

  test("jumping to an ancestor and appending creates a sibling branch", () => {
    const options = deterministicOptions();
    const root = createSessionTree<string>([], options);
    const first = appendSessionTreeNode(root, ["u1", "a1"], {}, options);
    const second = appendSessionTreeNode(first, ["u1", "a1", "u2", "a2"], {}, options);

    const back = jumpToSessionTreeNode(second, first.activeNodeId);
    const branch = appendSessionTreeNode(back, ["u1", "a1", "u2b", "a2b"], {}, options);
    const active = getActiveSessionTreeNode(branch);

    expect(active.parentId).toBe(first.activeNodeId);
    expect(branch.nodes.filter((node) => node.parentId === first.activeNodeId)).toHaveLength(2);
    expect(getParentSessionTreeNode(branch)?.id).toBe(first.activeNodeId);
  });

  test("restores legacy message arrays as a root snapshot", () => {
    const restored = restoreSessionTree<string>(["legacy-1", "legacy-2"], deterministicOptions());

    expect(restored.nodes).toHaveLength(1);
    expect(getActiveSessionTreeNode(restored).messages).toEqual(["legacy-1", "legacy-2"]);
  });
});
