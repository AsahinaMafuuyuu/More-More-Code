import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { act, useEffect, useRef } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { testRender } from "@opentui/react/test-utils";
import { RootLayout } from "../src/layouts/root-layout";
import { bootstrapAgentEnvironment, getAgentEnvironment } from "../src/lib/agent-environment";
import { type CustomProviderConfig } from "../src/lib/provider-registry";
import { useSessionCommandHandler } from "../src/ui/session/command/use-session-command-handler";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
    ));
});

function OpenProvidersCommand() {
    const execute = useSessionCommandHandler({});
    const opened = useRef(false);

    useEffect(() => {
        if (opened.current) return;
        opened.current = true;
        void execute({
            type: "command",
            commandName: "providers",
            commandValue: "/providers",
        });
    }, [execute]);

    return <text>command route</text>;
}

async function renderProvidersRoute(configure?: (environment: Awaited<ReturnType<typeof bootstrapAgentEnvironment>>) => Promise<void>) {
    const root = await mkdtemp(path.join(tmpdir(), "more-more-code-provider-dialog-"));
    temporaryDirectories.push(root);
    const environment = await bootstrapAgentEnvironment({
        globalHome: path.join(root, "home"),
        workspaceRoot: path.join(root, "workspace"),
    });
    await configure?.(environment);

    const router = createMemoryRouter([
        {
            path: "/",
            element: <RootLayout />,
            errorElement: <box><text>route error</text></box>,
            children: [{ index: true, element: <OpenProvidersCommand /> }],
        },
    ], { initialEntries: ["/"] });

    return testRender(<RouterProvider router={router} />, {
        width: 100,
        height: 40,
    });
}

async function flushUi(setup: Awaited<ReturnType<typeof renderProvidersRoute>>) {
    await act(async () => {
        await setup.flush({ maxPasses: 10 });
    });
}

async function moveSelectionDown(
    setup: Awaited<ReturnType<typeof renderProvidersRoute>>,
    count: number,
) {
    for (let index = 0; index < count; index += 1) {
        await act(async () => {
            setup.mockInput.pressArrow("down");
        });
        await flushUi(setup);
    }
}

async function selectCurrentItem(setup: Awaited<ReturnType<typeof renderProvidersRoute>>) {
    await act(async () => {
        setup.mockInput.pressEnter();
    });
    await flushUi(setup);
}

describe("/providers dialog context", () => {
    test("renders the provider dialog through the RootLayout context boundary", async () => {
        const setup = await renderProvidersRoute();
        try {
            await flushUi(setup);
            const frame = setup.captureCharFrame();

            expect(frame).toContain("Providers");
            expect(frame).toContain("Provider config is local");
            expect(frame).toContain("Search providers");
        } finally {
            setup.renderer.destroy();
        }
    });

    test("passes the live model into the custom-provider editor save seam", async () => {
        const customProvider: CustomProviderConfig = {
            id: "editor-provider",
            kind: "custom",
            displayName: "Editor Provider",
            enabled: true,
            protocol: "openai-compatible",
            baseURL: "https://editor.example.com/v1",
            models: ["editor-model"],
            auth: { type: "none" },
        };
        const setup = await renderProvidersRoute(async (environment) => {
            await environment.providers.saveProvider(customProvider);
        });

        try {
            await flushUi(setup);
            expect(setup.captureCharFrame()).toContain("Editor Provider");

            await moveSelectionDown(setup, 4);
            await selectCurrentItem(setup);
            expect(setup.captureCharFrame()).toContain("Edit custom provider");

            await moveSelectionDown(setup, 2);
            await selectCurrentItem(setup);
            expect(setup.captureCharFrame()).toContain("Provider ID");

            await act(async () => {
                setup.mockInput.pressKey("s", { ctrl: true });
            });
            await flushUi(setup);
            expect(setup.captureCharFrame()).toContain("Editor Provider");
            expect(getAgentEnvironment().providers.get(customProvider.id)).toEqual(customProvider);
        } finally {
            setup.renderer.destroy();
        }
    });
});
