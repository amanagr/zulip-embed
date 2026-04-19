import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

import "../src/index.ts";
import {renderMessage} from "../src/render.ts";
import type {
    ConfirmationMessagePart,
    Message,
    ZulipConfirmationResponseEventDetail,
} from "../src/types.ts";

function confirmationMessage(part: ConfirmationMessagePart): Message {
    return {
        id: 1,
        senderId: 99,
        senderFullName: "Agent",
        senderEmail: "agent@example.com",
        avatarUrl: "",
        timestamp: Date.now(),
        content: part.prompt,
        contentIsHtml: false,
        parts: [part],
        reactions: [],
        type: "channel",
        channelName: "general",
        topic: "t",
    };
}

function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushMany(n: number): Promise<void> {
    for (let i = 0; i < n; i++) await flush();
}

describe("renderPart — confirmation", () => {
    test("renders a card with the prompt + default Approve / Deny labels", () => {
        const part: ConfirmationMessagePart = {
            type: "confirmation",
            id: "conf-1",
            prompt: "Run `rm -rf /tmp/cache`?",
            payloadSig: "sig-abc",
        };
        const node = renderMessage(confirmationMessage(part), false);
        const card = node.querySelector<HTMLElement>(".confirmation-card");
        expect(card).not.toBeNull();
        expect(card?.dataset["confirmationId"]).toBe("conf-1");
        expect(node.querySelector(".confirmation-prompt")?.textContent).toBe(
            "Run `rm -rf /tmp/cache`?",
        );
        const approve = node.querySelector<HTMLButtonElement>(".confirmation-button.approve");
        const deny = node.querySelector<HTMLButtonElement>(".confirmation-button.deny");
        expect(approve?.textContent).toBe("Approve");
        expect(deny?.textContent).toBe("Deny");
    });

    test("honors approveLabel / denyLabel overrides", () => {
        const part: ConfirmationMessagePart = {
            type: "confirmation",
            id: "conf-2",
            prompt: "Delete draft?",
            approveLabel: "Yes, delete",
            denyLabel: "Keep it",
            payloadSig: "sig-def",
        };
        const node = renderMessage(confirmationMessage(part), false);
        expect(
            node.querySelector<HTMLButtonElement>(".confirmation-button.approve")?.textContent,
        ).toBe("Yes, delete");
        expect(
            node.querySelector<HTMLButtonElement>(".confirmation-button.deny")?.textContent,
        ).toBe("Keep it");
    });

    test("buttons carry data-confirmation-id / action / sig attributes", () => {
        const part: ConfirmationMessagePart = {
            type: "confirmation",
            id: "conf-3",
            prompt: "?",
            payloadSig: "sig-xyz",
        };
        const node = renderMessage(confirmationMessage(part), false);
        const approve = node.querySelector<HTMLButtonElement>(".confirmation-button.approve");
        const deny = node.querySelector<HTMLButtonElement>(".confirmation-button.deny");
        expect(approve?.dataset["confirmationId"]).toBe("conf-3");
        expect(approve?.dataset["confirmationAction"]).toBe("approve");
        expect(approve?.dataset["confirmationSig"]).toBe("sig-xyz");
        expect(deny?.dataset["confirmationId"]).toBe("conf-3");
        expect(deny?.dataset["confirmationAction"]).toBe("deny");
        expect(deny?.dataset["confirmationSig"]).toBe("sig-xyz");
    });

    test("clicking Approve dispatches a bubbling CustomEvent with the right detail", () => {
        const part: ConfirmationMessagePart = {
            type: "confirmation",
            id: "conf-4",
            prompt: "Proceed?",
            payloadSig: "sig-4",
        };
        const node = renderMessage(confirmationMessage(part), false);
        const host = document.createElement("div");
        host.append(node);
        // Attach a listener on the outer host: the event must bubble
        // out of the card.
        const seen: ZulipConfirmationResponseEventDetail[] = [];
        host.addEventListener("zulip-confirmation-response", (event) => {
            if (event instanceof CustomEvent) {
                seen.push(event.detail as ZulipConfirmationResponseEventDetail);
            }
        });
        node.querySelector<HTMLButtonElement>(".confirmation-button.approve")?.click();
        expect(seen).toEqual([{id: "conf-4", action: "approve", payloadSig: "sig-4"}]);
    });

    test("clicking Deny dispatches with action=deny", () => {
        const part: ConfirmationMessagePart = {
            type: "confirmation",
            id: "conf-5",
            prompt: "Stop?",
            payloadSig: "sig-5",
        };
        const node = renderMessage(confirmationMessage(part), false);
        const host = document.createElement("div");
        host.append(node);
        const seen: ZulipConfirmationResponseEventDetail[] = [];
        host.addEventListener("zulip-confirmation-response", (event) => {
            if (event instanceof CustomEvent) {
                seen.push(event.detail as ZulipConfirmationResponseEventDetail);
            }
        });
        node.querySelector<HTMLButtonElement>(".confirmation-button.deny")?.click();
        expect(seen).toEqual([{id: "conf-5", action: "deny", payloadSig: "sig-5"}]);
    });

    test("both buttons become disabled after the first click (idempotency)", () => {
        const part: ConfirmationMessagePart = {
            type: "confirmation",
            id: "conf-6",
            prompt: "?",
            payloadSig: "sig-6",
        };
        const node = renderMessage(confirmationMessage(part), false);
        const approve = node.querySelector<HTMLButtonElement>(".confirmation-button.approve");
        const deny = node.querySelector<HTMLButtonElement>(".confirmation-button.deny");
        expect(approve?.disabled).toBe(false);
        expect(deny?.disabled).toBe(false);
        approve?.click();
        expect(approve?.disabled).toBe(true);
        expect(deny?.disabled).toBe(true);
        expect(
            node.querySelector<HTMLElement>(".confirmation-card")?.dataset["confirmationResolved"],
        ).toBe("approve");
    });

    test("clicking a disabled button after resolution is a no-op", () => {
        const part: ConfirmationMessagePart = {
            type: "confirmation",
            id: "conf-7",
            prompt: "?",
            payloadSig: "sig-7",
        };
        const node = renderMessage(confirmationMessage(part), false);
        const host = document.createElement("div");
        host.append(node);
        const seen: ZulipConfirmationResponseEventDetail[] = [];
        host.addEventListener("zulip-confirmation-response", (event) => {
            if (event instanceof CustomEvent) {
                seen.push(event.detail as ZulipConfirmationResponseEventDetail);
            }
        });
        const approve = node.querySelector<HTMLButtonElement>(".confirmation-button.approve");
        const deny = node.querySelector<HTMLButtonElement>(".confirmation-button.deny");
        approve?.click();
        // JSDOM still dispatches click on a disabled button via
        // .click() even though a real user event wouldn't fire. Call
        // both to confirm the handler short-circuits on the
        // `disabled` flag regardless.
        approve?.click();
        deny?.click();
        expect(seen).toHaveLength(1);
        expect(seen[0]?.action).toBe("approve");
    });
});

describe("<zulip-chat> — confirmation event forwarding", () => {
    beforeEach(() => {
        vi.useFakeTimers({shouldAdvanceTime: true});
    });

    afterEach(() => {
        document.body.replaceChildren();
        vi.useRealTimers();
    });

    test("dispatches zulip-confirmation-response on the host element", async () => {
        const el = document.createElement("zulip-chat");
        el.setAttribute("demo", "");
        el.setAttribute("channel", "general");
        document.body.append(el);
        await flushMany(5);

        const seen: ZulipConfirmationResponseEventDetail[] = [];
        el.addEventListener("zulip-confirmation-response", (event) => {
            if (event instanceof CustomEvent) {
                seen.push(event.detail as ZulipConfirmationResponseEventDetail);
            }
        });

        // Simulate a confirmation card living inside the shadow root
        // (the embedder would normally inject it via
        // startAgentReply().appendEvent(...)). The widget's own event
        // is shadow-scoped (`composed: false`) so only the component's
        // shadow-root listener catches it; the component then re-emits
        // a composed event on the host element for outer embedders.
        const root = el.shadowRoot?.querySelector<HTMLElement>(".root");
        expect(root).not.toBeNull();
        const origin = document.createElement("div");
        root?.append(origin);
        origin.dispatchEvent(
            new CustomEvent<ZulipConfirmationResponseEventDetail>("zulip-confirmation-response", {
                detail: {id: "c-1", action: "approve", payloadSig: "s-1"},
                bubbles: true,
                composed: false,
            }),
        );

        expect(seen).toEqual([{id: "c-1", action: "approve", payloadSig: "s-1"}]);
    });

    test("an actual widget inside the component forwards to the host exactly once", () => {
        // End-to-end check: the rendered widget dispatches a shadow-
        // scoped event, the component re-emits a composed one. The
        // outer listener must see exactly one event — not zero (plumb
        // broken), not two (composed: true somewhere it shouldn't be).
        const part: ConfirmationMessagePart = {
            type: "confirmation",
            id: "e2e",
            prompt: "ok?",
            payloadSig: "e2e-sig",
        };
        const node = renderMessage(confirmationMessage(part), false);

        // Stage the rendered node under a synthetic shadow host so we
        // can observe the re-emit pattern without a full component
        // mount (which is exercised in the sibling test above).
        const host = document.createElement("div");
        const shadow = host.attachShadow({mode: "open"});
        const inner = document.createElement("div");
        shadow.append(inner);
        inner.append(node);
        document.body.append(host);

        const seen: ZulipConfirmationResponseEventDetail[] = [];
        host.addEventListener("zulip-confirmation-response", (event) => {
            if (event instanceof CustomEvent) {
                seen.push(event.detail as ZulipConfirmationResponseEventDetail);
            }
        });
        // Mirror component.ts: shadow-root listener re-emits as a
        // composed event on the host.
        shadow.addEventListener("zulip-confirmation-response", (event) => {
            if (!(event instanceof CustomEvent)) return;
            host.dispatchEvent(
                new CustomEvent<ZulipConfirmationResponseEventDetail>(
                    "zulip-confirmation-response",
                    {
                        detail: event.detail as ZulipConfirmationResponseEventDetail,
                        bubbles: true,
                        composed: true,
                    },
                ),
            );
        });

        node.querySelector<HTMLButtonElement>(".confirmation-button.approve")?.click();

        expect(seen).toEqual([{id: "e2e", action: "approve", payloadSig: "e2e-sig"}]);
        host.remove();
    });
});
