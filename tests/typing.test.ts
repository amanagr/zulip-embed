import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

import "../src/index.ts";
import {DemoTransport} from "../src/demo-transport.ts";
import type {TypingEvent, ZulipEvent} from "../src/types.ts";

function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("typing indicators", () => {
    beforeEach(() => {
        // shouldAdvanceTime lets microtasks keep running while we still
        // control setTimeout so the typing debounce can fire on command.
        vi.useFakeTimers({shouldAdvanceTime: true});
    });

    afterEach(() => {
        document.body.replaceChildren();
        vi.useRealTimers();
    });

    test("demo transport emits a typing event after the start debounce", async () => {
        const transport = new DemoTransport({scope: {channel: "general"}});
        const events: ZulipEvent[] = [];
        await transport.connect((e) => events.push(e));
        await transport.sendTyping("start", {channel: "general"});
        vi.advanceTimersByTime(500);
        const typing = events.find(
            (e): e is TypingEvent => e.type === "typing" && e.users.length > 0,
        );
        expect(typing).toBeDefined();
        expect(typing?.users[0]?.fullName).toBe("Zulip Bot");
        await transport.close();
    });

    test("demo transport clears typing users on stop", async () => {
        const transport = new DemoTransport({scope: {channel: "general"}});
        const events: ZulipEvent[] = [];
        await transport.connect((e) => events.push(e));
        await transport.sendTyping("start", {channel: "general"});
        vi.advanceTimersByTime(500);
        await transport.sendTyping("stop", {channel: "general"});
        const last = [...events].reverse().find(
            (e): e is TypingEvent => e.type === "typing",
        );
        expect(last?.users).toEqual([]);
        await transport.close();
    });

    test("demo transport debounces rapid start/stop without flickering", async () => {
        const transport = new DemoTransport({scope: {channel: "general"}});
        const events: ZulipEvent[] = [];
        await transport.connect((e) => events.push(e));
        await transport.sendTyping("start", {channel: "general"});
        // Cancel before the 400ms debounce elapses.
        await transport.sendTyping("stop", {channel: "general"});
        vi.advanceTimersByTime(1000);
        // The only typing event should be the explicit stop (empty list).
        const typingEvents = events.filter(
            (e): e is TypingEvent => e.type === "typing",
        );
        expect(typingEvents.length).toBeGreaterThanOrEqual(1);
        // None of them should have populated users.
        expect(typingEvents.every((e) => e.users.length === 0)).toBe(true);
        await transport.close();
    });

    test("component renders a typing indicator when peers are typing", async () => {
        // Real timers are easier here because we drive state directly.
        vi.useRealTimers();
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        document.body.append(el);

        for (let i = 0; i < 5; i++) await flush();

        const shadow = el.shadowRoot!;
        const indicator = shadow.querySelector<HTMLElement>(".typing-indicator");
        expect(indicator).not.toBeNull();
        expect(indicator?.hidden).toBe(true);

        // Poke state directly to exercise the render path.
        type Internal = {
            state: unknown;
            setState: (patch: Record<string, unknown>) => void;
        };
        const internal = el as unknown as Internal;
        internal.setState({
            typingUsers: [{userId: 99, fullName: "Iago"}],
        });
        expect(indicator?.hidden).toBe(false);
        expect(indicator?.textContent).toBe("Iago is typing");

        internal.setState({
            typingUsers: [
                {userId: 99, fullName: "Iago"},
                {userId: 100, fullName: "Cordelia"},
            ],
        });
        expect(indicator?.textContent).toBe("Iago and Cordelia are typing");

        internal.setState({
            typingUsers: [
                {userId: 1, fullName: "A"},
                {userId: 2, fullName: "B"},
                {userId: 3, fullName: "C"},
            ],
        });
        expect(indicator?.textContent).toBe("Several people are typing");

        internal.setState({typingUsers: []});
        expect(indicator?.hidden).toBe(true);
    });

    test("composer keystroke sends a start ping and schedules a stop", async () => {
        vi.useRealTimers();
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        document.body.append(el);

        for (let i = 0; i < 5; i++) await flush();

        // Spy on the underlying client's sendTyping by swapping in a stub.
        type Internal = {
            client: {sendTyping: (op: string, scope: unknown) => Promise<void>} | undefined;
            onComposerKeystroke: () => void;
            stopTyping: () => void;
            composerInputEl: HTMLTextAreaElement | undefined;
        };
        const internal = el as unknown as Internal;
        expect(internal.client).toBeDefined();

        const calls: string[] = [];
        const originalSend = internal.client!.sendTyping.bind(internal.client);
        internal.client!.sendTyping = async (op, scope) => {
            calls.push(op);
            return originalSend(op, scope);
        };

        // Put some text in the composer so the keystroke isn't treated
        // as an empty-input stop.
        internal.composerInputEl!.value = "hello";
        internal.onComposerKeystroke();
        // First keystroke triggers an immediate "start".
        expect(calls).toContain("start");

        // Subsequent keystrokes within the idle window don't duplicate
        // the start; they only reset the idle timer.
        const startsSoFar = calls.filter((c) => c === "start").length;
        internal.onComposerKeystroke();
        internal.onComposerKeystroke();
        expect(calls.filter((c) => c === "start").length).toBe(startsSoFar);

        // An explicit stop fires a "stop" ping.
        internal.stopTyping();
        expect(calls).toContain("stop");
    });

    test("read-only mode does not send typing pings", async () => {
        vi.useRealTimers();
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("read-only", "");
        el.setAttribute("channel", "general");
        document.body.append(el);

        for (let i = 0; i < 5; i++) await flush();

        type Internal = {
            client: {sendTyping: (op: string, scope: unknown) => Promise<void>} | undefined;
            onComposerKeystroke: () => void;
        };
        const internal = el as unknown as Internal;

        const calls: string[] = [];
        if (internal.client) {
            internal.client.sendTyping = async (op) => {
                calls.push(op);
            };
        }

        internal.onComposerKeystroke();
        expect(calls.length).toBe(0);
    });
});
