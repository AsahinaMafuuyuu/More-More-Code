import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { RootLayout } from "./layouts/root-layout";
import { Home } from "./screens/home";
import { NewSession } from "./screens/new-session";
import { Session } from "./screens/session";
import { bootstrapAgentEnvironment } from "./lib/agent-environment";
import { bootstrapRuntimeEnvironment } from "./lib/runtime-environment";
import { bootstrapLocalSessionEnvironment } from "./lib/session-environment";
import { resolveTuiRenderProfileFromEnvironment } from "./tui/render-profile";

// Agent bootstrap resolves ~/.more-more-code and workspace .more-more-code before any session can run.
await bootstrapAgentEnvironment();
await Promise.all([
  bootstrapRuntimeEnvironment(),
  bootstrapLocalSessionEnvironment(),
]);

const router = createMemoryRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <Home />,
      },
      {
        path: "sessions/new",
        element: <NewSession />,
      },
      {
        path: "sessions/:id",
        element: <Session />,
      },
    ],
  },
]);

function App() {
  return <RouterProvider router={router} />;
}

const renderProfile = resolveTuiRenderProfileFromEnvironment();
const renderer = await createCliRenderer({
  targetFps: renderProfile.targetFps,
  maxFps: renderProfile.maxFps,
  exitOnCtrlC: false,
});
createRoot(renderer).render(<App />);
