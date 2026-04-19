import {describe, expect, test} from "vitest";
import {act, render} from "@testing-library/react";
import {useMemo} from "react";

import {useZulipChat} from "../src/hooks.js";
import type {Transport} from "@zulip/embed";
import {DemoTransport} from "@zulip/embed";

// A thin probe component that renders the hook's output as data
// attributes so the test can inspect status + message count without
// reaching into React internals. We go through a hook here rather
// than calling useZulipChat in the test body because hooks can only
// run inside a component.
function Probe({transport}: {transport: Transport}): JSX.Element {
    const scope = useMemo(() => ({channel: "general"}), []);
    const {messages, status} = useZulipChat(transport, scope);
    return (
        <div
            data-testid="probe"
            data-status={status}
            data-count={String(messages.length)}
        />
    );
}

describe("useZulipChat", () => {
    test("transitions from idle/connecting to connected with seeded demo messages", async () => {
        const transport = new DemoTransport({
            scope: {channel: "general"},
            autoReply: false,
        });

        const {container} = render(<Probe transport={transport} />);
        // `connect()` is fire-and-forget inside the effect, so we need
        // a microtask flush before the state reflects the demo
        // transport's synchronous connection + initial fetch.
        await act(async () => {
            await new Promise((r) => setTimeout(r, 20));
        });

        const probe = container.querySelector('[data-testid="probe"]');
        expect(probe).not.toBeNull();
        expect(probe?.getAttribute("data-status")).toBe("connected");
        // DemoTransport seeds a non-empty welcome history; assert we
        // picked up at least one message without depending on the
        // exact seed count (which varies per variant).
        expect(Number(probe?.getAttribute("data-count"))).toBeGreaterThan(0);
    });

    test("sendMessage is stable across re-renders and forwards string input", async () => {
        const transport = new DemoTransport({
            scope: {channel: "general"},
            autoReply: false,
        });
        let sendMessageRef: ((s: string) => Promise<void>) | undefined;
        let renderCount = 0;

        function Capture(): JSX.Element {
            const scope = useMemo(() => ({channel: "general"}), []);
            const {sendMessage} = useZulipChat(transport, scope);
            // The *reference* to sendMessage must be stable across
            // renders — otherwise consumers memoizing off it would
            // burn a cycle on every parent render.
            if (sendMessageRef === undefined) {
                sendMessageRef = sendMessage;
            } else {
                expect(sendMessage).toBe(sendMessageRef);
            }
            renderCount++;
            return <div data-testid="capture" />;
        }

        await act(async () => {
            const {rerender} = render(<Capture />);
            await new Promise((r) => setTimeout(r, 10));
            rerender(<Capture />);
            await new Promise((r) => setTimeout(r, 10));
        });

        expect(renderCount).toBeGreaterThanOrEqual(2);
        expect(typeof sendMessageRef).toBe("function");
        // Calling sendMessage("hi") should route through the bound
        // scope — the demo transport accepts and echoes it without
        // throwing, which is our stand-in for a successful dispatch.
        await act(async () => {
            await sendMessageRef?.("hi");
            await new Promise((r) => setTimeout(r, 10));
        });
    });
});
