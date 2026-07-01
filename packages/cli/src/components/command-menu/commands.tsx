import type { Command } from "./types";
export const COMMANDS:Command[] = [
    {
        name: "new",
        description: "Start a new conversation",
        value : "/new",
    },
    {
        name: 'agents',
        description: "Switch agents",
        value : "/agents",
    },
    {
        name: 'models',
        description: "Select AI model for generation",
        value : "/models",
    },
    {
        name: 'sessions',
        description: "Browse past sessions",
        value : "/sessions",
    },
    {
        name: 'theme',
        description: "Change the theme of the interface",
        value : "/theme",

    },
    {
        name: 'login',
        description: "Log in to your account",
        value : "/login",
    },
    {
        name: 'logout',
        description: "Log out of your account",
        value : "/logout",
    },
    {
        name: 'upgrade',
        description: "Buy more credits or upgrade your plan",
        value : "/upgrade",
    },
    {
        name: 'usage',
        description: "Open billing portal in your browser",
        value : "/usage",
    },
    {
        name: "exit",
        description: "Exit the program",
        value : "/exit",
        action: (ctx) => {
            ctx.exit()
        }
    },
]
