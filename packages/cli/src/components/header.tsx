import { green } from "@opentui/core";

export default function Header() {
    return (
        <box width="auto" height="auto">
            <box flexDirection="column" alignItems="center" gap={0.5}>
                <ascii-font font="block" color="#2fbc04a1" text="MMCode" />
                <ascii-font font="tiny" color="grey" text="Lucky" />
            </box>
        </box>
    )
}