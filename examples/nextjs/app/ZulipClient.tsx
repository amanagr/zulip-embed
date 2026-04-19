"use client";

// Client component. The "use client" directive is what makes Next.js
// skip this during server render — important because:
//
//   1. `zulip-embed` calls `customElements.define()` on import, which
//      requires `window` / `customElements`. Executing that on the
//      server blows up.
//   2. The component's internal state machine uses browser APIs
//      (timers, IntersectionObserver, etc.) that don't exist in Node.
//
// `zulip-embed-react`'s <ZulipChat> wrapper is itself already marked
// "use client" — we still wrap it in our own client component because
// that makes the SSR boundary explicit and lets us co-locate any
// demo-only UI state that should also stay on the client.

import {ZulipChat} from "zulip-embed-react";

export function ZulipClient() {
    return (
        <ZulipChat
            demo
            channel="general"
            topic="welcome"
            theme="light"
            mode="inline"
            brandName="Demo Chat"
            style={{
                display: "block",
                width: "100%",
                height: 560,
                borderRadius: 12,
                overflow: "hidden",
                boxShadow: "0 10px 30px -12px rgba(17, 24, 39, 0.25)",
            }}
        />
    );
}
