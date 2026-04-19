import {describe, expect, test, beforeEach, afterEach, vi} from "vitest";
import {render, cleanup} from "@testing-library/react";
import {createRef} from "react";

import {ZulipChat} from "../src/index.js";

// Under vitest, zulip-embed's `import` side effect calls
// customElements.define, so the real Web Component is registered
// before these tests run. That's what lets us assert on shadow DOM
// contents without any mocking.
describe("<ZulipChat />", () => {
    beforeEach(() => {
        vi.useFakeTimers({shouldAdvanceTime: true});
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    test("renders <zulip-chat> and forwards string props as attributes", () => {
        const {container} = render(
            <ZulipChat demo channel="general" topic="welcome" theme="light" mode="inline" />,
        );
        const el = container.querySelector("zulip-chat");
        expect(el).not.toBeNull();
        expect(el?.getAttribute("channel")).toBe("general");
        expect(el?.getAttribute("topic")).toBe("welcome");
        expect(el?.getAttribute("theme")).toBe("light");
        expect(el?.getAttribute("mode")).toBe("inline");
        expect(el?.hasAttribute("demo")).toBe(true);
    });

    test("omits attributes when the matching prop is undefined", () => {
        const {container} = render(<ZulipChat demo channel="general" />);
        const el = container.querySelector("zulip-chat");
        expect(el?.hasAttribute("topic")).toBe(false);
        expect(el?.hasAttribute("brand-name")).toBe(false);
        expect(el?.hasAttribute("brand-logo")).toBe(false);
    });

    test("forwards brand-name and brand-logo", () => {
        const {container} = render(
            <ZulipChat
                demo
                channel="general"
                brandName="Acme Support"
                brandLogo="https://example.com/logo.png"
            />,
        );
        const el = container.querySelector("zulip-chat");
        expect(el?.getAttribute("brand-name")).toBe("Acme Support");
        expect(el?.getAttribute("brand-logo")).toBe("https://example.com/logo.png");
    });

    test("updates attributes when props change", () => {
        const {container, rerender} = render(
            <ZulipChat demo channel="general" topic="welcome" />,
        );
        rerender(<ZulipChat demo channel="design" topic="feedback" theme="dark" />);
        const el = container.querySelector("zulip-chat");
        expect(el?.getAttribute("channel")).toBe("design");
        expect(el?.getAttribute("topic")).toBe("feedback");
        expect(el?.getAttribute("theme")).toBe("dark");
    });

    test("removes attributes when props become undefined", () => {
        const {container, rerender} = render(
            <ZulipChat demo channel="general" topic="welcome" brandName="Acme" />,
        );
        rerender(<ZulipChat demo channel="general" />);
        const el = container.querySelector("zulip-chat");
        expect(el?.hasAttribute("topic")).toBe(false);
        expect(el?.hasAttribute("brand-name")).toBe(false);
    });

    test("exposes the underlying element through ref", () => {
        const ref = createRef<HTMLElement>();
        render(<ZulipChat ref={ref} demo channel="general" />);
        expect(ref.current).toBeInstanceOf(HTMLElement);
        expect(ref.current?.tagName.toLowerCase()).toBe("zulip-chat");
    });

    test("forwards zulip-connection-change CustomEvent to onConnectionChange prop", () => {
        // Dispatch the event directly on the host element — this
        // verifies the wrapper's `addEventListener("zulip-connection-change", ...)`
        // subscription without depending on the underlying component
        // actually emitting it during the test (which depends on
        // async transport setup).
        const ref = createRef<HTMLElement>();
        const received: Array<{status: string}> = [];
        render(
            <ZulipChat
                ref={ref}
                demo
                channel="general"
                onConnectionChange={(detail) => received.push(detail)}
            />,
        );
        ref.current?.dispatchEvent(
            new CustomEvent("zulip-connection-change", {
                detail: {status: "connected"},
            }),
        );
        expect(received).toHaveLength(1);
        expect(received[0]?.status).toBe("connected");
    });

    test("forwards zulip-message CustomEvent to onMessage prop", () => {
        const ref = createRef<HTMLElement>();
        const received: Array<{message: {id: number}}> = [];
        render(
            <ZulipChat
                ref={ref}
                demo
                channel="general"
                onMessage={(detail) => received.push(detail)}
            />,
        );
        ref.current?.dispatchEvent(
            new CustomEvent("zulip-message", {detail: {message: {id: 42}}}),
        );
        expect(received).toHaveLength(1);
        expect(received[0]?.message.id).toBe(42);
    });

    test("forwards zulip-error CustomEvent to onError prop", () => {
        const ref = createRef<HTMLElement>();
        const received: Array<{code: string; error: string}> = [];
        render(
            <ZulipChat
                ref={ref}
                demo
                channel="general"
                onError={(detail) => received.push(detail)}
            />,
        );
        ref.current?.dispatchEvent(
            new CustomEvent("zulip-error", {
                detail: {code: "unauthorized", error: "bad token"},
            }),
        );
        expect(received).toHaveLength(1);
        expect(received[0]?.code).toBe("unauthorized");
    });

    test("callback refs stay current without rebinding listeners on prop change", () => {
        // Re-rendering with a new `onMessage` handler should route
        // subsequent events to the NEW handler, but the underlying
        // addEventListener call should still only have happened once
        // — we can't assert that directly, but we can check that the
        // new handler receives events and the old handler doesn't.
        const ref = createRef<HTMLElement>();
        const first: Array<{message: {id: number}}> = [];
        const second: Array<{message: {id: number}}> = [];
        const {rerender} = render(
            <ZulipChat
                ref={ref}
                demo
                channel="general"
                onMessage={(detail) => first.push(detail)}
            />,
        );
        ref.current?.dispatchEvent(
            new CustomEvent("zulip-message", {detail: {message: {id: 1}}}),
        );
        rerender(
            <ZulipChat
                ref={ref}
                demo
                channel="general"
                onMessage={(detail) => second.push(detail)}
            />,
        );
        ref.current?.dispatchEvent(
            new CustomEvent("zulip-message", {detail: {message: {id: 2}}}),
        );
        expect(first.map((d) => d.message.id)).toEqual([1]);
        expect(second.map((d) => d.message.id)).toEqual([2]);
    });
});
