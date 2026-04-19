// Shared DM-bucketing helper. Lives in its own module (rather than on
// `zulip-transport.ts`, where it was born) so SnapshotTransport and
// DemoTransport can call it without dragging the Zulip-transport chunk —
// and its zod/fetch surface — into the demo / snapshot bundles. The
// function is pure and has no dependencies beyond the shared types.

import type {DirectMessageConversation} from "./transport.ts";
import type {DirectMessage, Message, User} from "./types.ts";

// Bucket a flat list of messages into DM conversations, keyed by the
// sorted set of recipients + sender (excluding the viewer so a one-on-one
// DM's key is the *other* user, not the full pair). Sorted most-recent
// first. Shared between `ZulipTransport.listDirectMessageConversations`
// and `SnapshotTransport.listDirectMessageConversations` so both code
// paths produce identically-shaped output.
export function bucketDirectMessages(
    messages: Message[],
    viewerId: number | undefined,
): DirectMessageConversation[] {
    const buckets = new Map<
        string,
        {users: Map<number, User>; lastMessage: DirectMessage}
    >();
    for (const message of messages) {
        if (message.type !== "direct") continue;
        const participants = new Map<number, User>();
        // Always include sender + recipients; a DM the viewer sent has
        // recipients = "the other parties" on the wire but we want the
        // bucket key to be the full conversation regardless of who
        // authored the most recent message.
        if (message.senderId !== viewerId) {
            participants.set(message.senderId, {
                userId: message.senderId,
                email: message.senderEmail,
                fullName: message.senderFullName,
                avatarUrl: message.avatarUrl,
            });
        }
        for (const recipient of message.recipients) {
            if (recipient.userId === viewerId) continue;
            participants.set(recipient.userId, recipient);
        }
        if (participants.size === 0) {
            // DM-to-self — keep a bucket keyed on the viewer so
            // self-reminders still surface in the list. Synthesize a
            // minimal self User from the sender metadata.
            participants.set(message.senderId, {
                userId: message.senderId,
                email: message.senderEmail,
                fullName: message.senderFullName,
                avatarUrl: message.avatarUrl,
            });
        }
        const key = [...participants.keys()].sort((a, b) => a - b).join(",");
        const existing = buckets.get(key);
        if (existing === undefined || message.id > existing.lastMessage.id) {
            buckets.set(key, {users: participants, lastMessage: message});
        } else {
            // Merge participants — if an older message happened to carry
            // a recipient the newer one didn't, retain them so the
            // bucket's user list is complete.
            for (const [id, user] of participants) {
                if (!existing.users.has(id)) existing.users.set(id, user);
            }
        }
    }
    const rows: DirectMessageConversation[] = [];
    for (const bucket of buckets.values()) {
        rows.push({
            users: [...bucket.users.values()].sort((a, b) => a.userId - b.userId),
            lastMessageId: bucket.lastMessage.id,
            lastMessageTime: bucket.lastMessage.timestamp,
        });
    }
    rows.sort((a, b) => b.lastMessageTime - a.lastMessageTime);
    return rows;
}
