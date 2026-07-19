import { Children } from "react";
import type { Command } from "./types";
import { SUPPORTED_CHAT_MODELS } from "@more-more-code/shared";
import { ThemeDialogContent, AgentsDialogContent, SessionsDialogContent, ModelsDialogContent } from "../dialogs";

export const COMMANDS: Command[] = [
    {
        name: "new",
        description: "Start a new conversation",
        value: "/new",
        action: (ctx) => {
            ctx.navigate("/")
        }
    },
    {
        name: 'agents',
        description: "Switch agents",
        value: "/agents",
        action: (ctx) => {
            ctx.dialog.open({
                title: "Select Agent",
                children: <AgentsDialogContent 
                currentMode={ctx.mode}
                onSelecteMode={ctx.setMode}
                />
            })
        }
    },
    {
        name: 'models',
        description: "Select AI model for generation",
        value: "/models",
        action: (ctx) => {
            ctx.dialog.open({
                title: "Select Model",
                children: <ModelsDialogContent 
                models={SUPPORTED_CHAT_MODELS.map((model) => model.id)}
                onSelectModel={ctx.setModel}
                />
            })
        }
    },
    {
        name: 'sessions',
        description: "Browse past sessions",
        value: "/sessions",
        action: (ctx) => {
            ctx.dialog.open({
                title: "Sessions",
                children: <SessionsDialogContent />
            })
        }
    },
    {
        name: 'theme',
        description: "Change the theme of the interface",
        value: "/theme",
        action: (ctx) => {
            ctx.dialog.open({
                title: "Select Theme",
                children: <ThemeDialogContent />
            })
        }

    },
    {
        name: 'login',
        description: "Log in to your account",
        value: "/login",
        action: (ctx) => {
            ctx.toast.show({
                message: "Opening browser to sign in...",
            })
        }
    },
    {
        name: 'logout',
        description: "Log out of your account",
        value: "/logout",
        action: (ctx) => {
            ctx.toast.show({
                message: "Signed out...",
                variant: "success", // 显示成功消息
            })
        }
    },
    {
        name: 'upgrade',
        description: "Buy more credits or upgrade your plan",
        value: "/upgrade",
        action: (ctx) => {
            ctx.toast.show({
                message: "Opening credits checkout...",
            })
        }
    },
    {
        name: 'usage',
        description: "Open billing portal in your browser",
        value: "/usage",
        action: (ctx) => {
            ctx.toast.show({
                message: "Opening billing portal...",
            })
        }
    },
    {
        name: "exit",
        description: "Exit the program",
        value: "/exit",
        action: (ctx) => {
            ctx.exit()
        }
    },
]
