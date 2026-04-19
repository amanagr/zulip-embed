// Minimal React integration: import <ZulipChat> from `zulip-embed-react`
// and drop it anywhere. The wrapper side-effect-registers the
// underlying <zulip-chat> Custom Element on import, so you don't also
// need `import "zulip-embed"`.
//
// `demo` disables every network path and routes through an in-memory
// seeded transport with an echo bot. Remove it and pass
// `server` / `authToken` for a live connection (see docs/jwt.md).

import {ZulipChat} from "zulip-embed-react";

export function App() {
    return (
        <main
            style={{
                maxWidth: 720,
                margin: "0 auto",
                padding: "32px 20px 56px",
            }}
        >
            <h1 style={{fontSize: 22, margin: "0 0 8px"}}>
                Zulip Embed — React (Vite) example
            </h1>
            <p
                style={{
                    margin: "0 0 24px",
                    color: "#4b5563",
                    fontSize: 14,
                    lineHeight: 1.55,
                }}
            >
                This page renders <code>&lt;ZulipChat demo&gt;</code> from{" "}
                <code>zulip-embed-react</code>. Demo mode routes through an in-memory
                transport with seeded messages — no server needed.
            </p>

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
                onMessage={(detail) => {
                    // Typed event — detail.message has the full Zulip message shape.
                    console.log("message:", detail.message);
                }}
                onConnectionChange={(detail) => {
                    console.log("connection:", detail.status);
                }}
            />

            <p
                style={{
                    marginTop: 20,
                    textAlign: "center",
                    fontSize: 12,
                    color: "#6b7280",
                }}
            >
                Drop <code>demo</code> and add <code>server</code> and{" "}
                <code>authToken</code> for live mode.
            </p>
        </main>
    );
}
