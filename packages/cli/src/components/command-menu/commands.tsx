import type { Command } from "./types";

/** Display/search metadata only. Execution belongs to SessionCommandRouter. */
export const COMMANDS: Command[] = [
  { name: "new", description: "Start a new conversation", value: "/new" },
  { name: "agents", description: "Switch agents", value: "/agents" },
  { name: "models", description: "Select AI model for generation", value: "/models" },
  { name: "providers", description: "Manage local model providers and credentials", value: "/providers" },
  { name: "sessions", description: "Browse past sessions", value: "/sessions" },
  { name: "tree", description: "Browse the current session tree and jump to any node", value: "/tree" },
  { name: "jump", description: "Jump to any node in the current session tree", value: "/jump" },
  { name: "parent", description: "Jump to the parent of the active session node", value: "/parent" },
  { name: "root", description: "Jump to the root of the current session tree", value: "/root" },
  { name: "compact", description: "Compact older context on the active session branch", value: "/compact" },
  { name: "settings", description: "Inspect and configure global/project agent settings", value: "/settings" },
  { name: "theme", description: "Change the theme of the interface", value: "/theme" },
  { name: "exit", description: "Exit the program", value: "/exit" },
];
