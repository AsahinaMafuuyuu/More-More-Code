import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createMemoryRouter, Router, RouterProvider } from "react-router";
import { RootLayout } from "./layouts/root-layout";
import { Home } from "./screens/home";
import { NewSession } from "./screens/new-session";
import { Session } from "./screens/session";

// 要使用多个会话，因此需要创建对应的路由：sessions/new 以及 sessions/:id
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
  }
])
function App() {
  return (
    <RouterProvider router={router} />
  );
}

const renderer = await createCliRenderer({
  targetFps: 60,
  exitOnCtrlC: false,
});
createRoot(renderer).render(<App />);
