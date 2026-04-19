import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

import {
    __resetDeprecationWarnings,
    canonicalUserIds,
    isChannelScope,
    isDmScope,
    normalizeScope,
} from "../src/scope.ts";
import type {ChannelScope, DmScope, NormalizedScope, ScopeFilter} from "../src/types.ts";

describe("ScopeFilter normalization", () => {
    beforeEach(() => {
        __resetDeprecationWarnings();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        __resetDeprecationWarnings();
    });

    test("passes through a modern channel scope verbatim", () => {
        const input: ChannelScope = {kind: "channel", channel: "general", topic: "welcome"};
        const normalized = normalizeScope(input);
        expect(normalized).toEqual({kind: "channel", channel: "general", topic: "welcome"});
    });

    test("preserves undefined topic on a channel scope", () => {
        const input: ChannelScope = {kind: "channel", channel: "general"};
        const normalized = normalizeScope(input);
        // The normalizer widens but does not invent a topic — topic stays
        // undefined so `getMessages` can match all topics on that channel.
        expect(normalized.kind).toBe("channel");
        if (normalized.kind !== "channel") throw new Error("expected channel scope");
        expect(normalized.channel).toBe("general");
        expect(normalized.topic).toBeUndefined();
    });

    test("canonicalizes DM user ids (sort + dedupe)", () => {
        const input: DmScope = {kind: "dm", userIds: [7, 3, 3, 5, 1, 7]};
        const normalized = normalizeScope(input);
        expect(normalized.kind).toBe("dm");
        if (normalized.kind !== "dm") throw new Error("expected dm scope");
        // Sorted ascending, with duplicates removed — this is the key
        // that downstream transports use to bucket conversations.
        expect(normalized.userIds).toEqual([1, 3, 5, 7]);
    });

    test("drops non-finite user ids from a DM scope", () => {
        const input: DmScope = {kind: "dm", userIds: [3, Number.NaN, 5, Number.POSITIVE_INFINITY]};
        const normalized = normalizeScope(input);
        if (normalized.kind !== "dm") throw new Error("expected dm scope");
        expect(normalized.userIds).toEqual([3, 5]);
    });

    test("accepts the legacy flat shape and widens to a channel scope", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const legacy = {channel: "general", topic: "welcome"} as ScopeFilter;
        const normalized = normalizeScope(legacy);
        expect(normalized).toEqual({kind: "channel", channel: "general", topic: "welcome"});
    });

    test("emits a one-shot deprecation warning for legacy shape", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const legacy = {channel: "general"} as ScopeFilter;
        normalizeScope(legacy);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toContain("deprecated");
    });

    test("dedupes the legacy-shape warning per call site in a loop", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        // Real adopters usually call normalizeScope in a tight loop from
        // the same source line (e.g. inside a transport method). All
        // iterations share the same stack fingerprint, so we dedupe to a
        // single warning regardless of iteration count.
        for (let i = 0; i < 5; i++) {
            normalizeScope({channel: "c"} as ScopeFilter);
        }
        expect(warn).toHaveBeenCalledTimes(1);
    });

    test("reset hook restores one-shot behavior between tests", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        normalizeScope({channel: "x"} as ScopeFilter);
        expect(warn).toHaveBeenCalledTimes(1);
        __resetDeprecationWarnings();
        normalizeScope({channel: "x"} as ScopeFilter);
        expect(warn).toHaveBeenCalledTimes(2);
    });

    test("canonicalUserIds is idempotent", () => {
        const ids = canonicalUserIds([5, 2, 2, 5, 9]);
        // Running it again on the already-canonical result must not change it.
        expect(canonicalUserIds(ids)).toEqual(ids);
        expect(ids).toEqual([2, 5, 9]);
    });

    test("canonicalUserIds treats negative ids as ordinary numbers", () => {
        // Zulip user ids are strictly positive in practice, but the helper
        // doesn't encode that invariant — it just sorts and dedupes.
        expect(canonicalUserIds([-3, 2, -3, 0])).toEqual([-3, 0, 2]);
    });

    test("isChannelScope / isDmScope narrow the union", () => {
        const channel: NormalizedScope = {kind: "channel", channel: "c"};
        const dm: NormalizedScope = {kind: "dm", userIds: [1, 2]};
        expect(isChannelScope(channel)).toBe(true);
        expect(isDmScope(channel)).toBe(false);
        expect(isChannelScope(dm)).toBe(false);
        expect(isDmScope(dm)).toBe(true);
    });

    test("does not warn when the modern shape is used", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        normalizeScope({kind: "channel", channel: "general"});
        normalizeScope({kind: "dm", userIds: [1, 2, 3]});
        expect(warn).not.toHaveBeenCalled();
    });
});
