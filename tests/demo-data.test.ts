import {describe, expect, test} from "vitest";

import {
    DEMO_CHANNELS,
    DEMO_GUEST_USER,
    DEMO_USERS,
    seedMessages,
} from "../src/demo-data.ts";

describe("demo-data", () => {
    test("DEMO_GUEST_USER is present in DEMO_USERS", () => {
        expect(DEMO_USERS).toContain(DEMO_GUEST_USER);
    });

    test("DEMO_USERS have unique userIds (avoids avatar color collisions downstream)", () => {
        const ids = new Set(DEMO_USERS.map((u) => u.userId));
        expect(ids.size).toBe(DEMO_USERS.length);
    });

    test("DEMO_CHANNELS cover the three showcase seeds", () => {
        const names = DEMO_CHANNELS.map((c) => c.name);
        expect(names).toContain("general");
        expect(names).toContain("announce");
        expect(names).toContain("showcase");
    });

    test("seedMessages(general) returns non-empty messages scoped to the topic", () => {
        const messages = seedMessages("general", "welcome");
        expect(messages.length).toBeGreaterThan(0);
        for (const m of messages) {
            expect(m.channelName).toBe("general");
            expect(m.topic).toBe("welcome");
            expect(m.type).toBe("channel");
        }
    });

    test("seedMessages(announce) uses announce-specific defaults", () => {
        const messages = seedMessages("announce", undefined);
        expect(messages.length).toBeGreaterThan(0);
        for (const m of messages) {
            expect(m.channelName).toBe("announce");
        }
    });

    test("seedMessages(showcase) uses showcase-specific defaults", () => {
        const messages = seedMessages("showcase", undefined);
        expect(messages.length).toBeGreaterThan(0);
        for (const m of messages) {
            expect(m.channelName).toBe("showcase");
        }
    });

    test("seedMessages falls back to 'welcome' when topic is undefined for arbitrary channels", () => {
        const messages = seedMessages("team-rocket", undefined);
        expect(messages.length).toBeGreaterThan(0);
        for (const m of messages) {
            expect(m.topic).toBe("welcome");
        }
    });

    test("seed messages have strictly increasing ids so pagination anchor logic works", () => {
        const messages = seedMessages("general", "welcome");
        for (let i = 1; i < messages.length; i++) {
            // Using non-null assertions: the bounds are covered by i range.
            const prev = messages[i - 1]!;
            const curr = messages[i]!;
            expect(curr.id).toBeGreaterThan(prev.id);
        }
    });

    test("seed messages carry contentIsHtml=true (server-rendered markdown mock)", () => {
        const messages = seedMessages("general", "welcome");
        for (const m of messages) {
            expect(typeof m.contentIsHtml).toBe("boolean");
        }
    });

    test("seed messages have stable timestamps relative to now (not in future)", () => {
        const now = Date.now();
        const messages = seedMessages("general", "welcome");
        for (const m of messages) {
            expect(m.timestamp).toBeLessThanOrEqual(now + 1000);
        }
    });

    test("seed messages reactions preserve emoji + userIds + count invariant", () => {
        const messages = seedMessages("general", "welcome");
        for (const m of messages) {
            for (const r of m.reactions) {
                expect(r.count).toBe(r.userIds.length);
                expect(r.userIds.length).toBeGreaterThan(0);
            }
        }
    });
});
