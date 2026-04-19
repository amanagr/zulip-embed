import {describe, expect, test, afterEach, vi} from "vitest";
import {render, cleanup} from "@testing-library/react";

import {ZulipChannelList, ZulipTopicList} from "../src/index.js";

describe("<ZulipChannelList /> and <ZulipTopicList />", () => {
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    test("channel list forwards snapshot-url and demo attributes", () => {
        const {container} = render(
            <ZulipChannelList snapshotUrl="/data/snap.json" theme="dark" />,
        );
        const el = container.querySelector("zulip-channel-list");
        expect(el?.getAttribute("snapshot-url")).toBe("/data/snap.json");
        expect(el?.getAttribute("theme")).toBe("dark");
        expect(el?.hasAttribute("demo")).toBe(false);
    });

    test("channel list invokes onChannelSelected when the underlying event fires", () => {
        const handler = vi.fn();
        const {container} = render(<ZulipChannelList demo onChannelSelected={handler} />);
        const el = container.querySelector("zulip-channel-list");
        el?.dispatchEvent(
            new CustomEvent("channel-selected", {
                detail: {channelId: 42, name: "design"},
            }),
        );
        expect(handler).toHaveBeenCalledWith({channelId: 42, name: "design"});
    });

    test("channel list swaps handler without re-binding the DOM listener", () => {
        const first = vi.fn();
        const second = vi.fn();
        const {container, rerender} = render(
            <ZulipChannelList demo onChannelSelected={first} />,
        );
        rerender(<ZulipChannelList demo onChannelSelected={second} />);
        const el = container.querySelector("zulip-channel-list");
        el?.dispatchEvent(
            new CustomEvent("channel-selected", {
                detail: {channelId: 1, name: "general"},
            }),
        );
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    test("topic list forwards the required channel attribute", () => {
        const {container} = render(<ZulipTopicList demo channel="announce" theme="light" />);
        const el = container.querySelector("zulip-topic-list");
        expect(el?.getAttribute("channel")).toBe("announce");
        expect(el?.getAttribute("theme")).toBe("light");
    });

    test("topic list invokes onTopicSelected with the event detail", () => {
        const handler = vi.fn();
        const {container} = render(
            <ZulipTopicList demo channel="announce" onTopicSelected={handler} />,
        );
        const el = container.querySelector("zulip-topic-list");
        el?.dispatchEvent(
            new CustomEvent("topic-selected", {detail: {topic: "Zulip 9.0"}}),
        );
        expect(handler).toHaveBeenCalledWith({topic: "Zulip 9.0"});
    });
});
