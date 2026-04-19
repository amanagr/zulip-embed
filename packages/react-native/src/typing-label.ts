// Build the "Alice is typing" / "Alice and Bob are typing" / "Several
// people are typing" label shown above the composer. Returns undefined
// when no one else is typing so the caller can hide the row entirely.
//
// Mirrors the same helper baked into the web `<zulip-chat>` element
// (see `formatTypingLabel` in `src/component.ts`). Kept as a standalone
// module so the RN widget can test the formatting in isolation without
// needing a jsdom / React renderer.
import type {TypingUser} from "./types.js";

export function formatTypingLabel(users: readonly TypingUser[]): string | undefined {
    if (users.length === 0) return undefined;
    const names = users.map((u) => u.fullName.trim()).filter((n) => n.length > 0);
    if (names.length === 0) return "Someone is typing";
    if (names.length === 1) return `${names[0]!} is typing`;
    if (names.length === 2) return `${names[0]!} and ${names[1]!} are typing`;
    return "Several people are typing";
}
