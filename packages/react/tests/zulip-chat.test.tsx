import {describe, expect, test, beforeEach, afterEach, vi} from "vitest";
import {render, cleanup} from "@testing-library/react";
import {createRef} from "react";

import {ZulipChat} from "../src/index.js";

// Under vitest, @zulip/embed's `import` side effect calls
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
});
