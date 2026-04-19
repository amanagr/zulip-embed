// Server component. Renders the static shell + mounts the
// `ZulipClient` wrapper below, which is a client component.
// Custom Elements only exist in the browser, so all of the
// `<zulip-chat>` machinery lives behind the "use client" boundary.

import {ZulipClient} from "./ZulipClient.js";

export default function Page() {
    return (
        <main
            style={{
                maxWidth: 720,
                margin: "0 auto",
                padding: "32px 20px 56px",
            }}
        >
            <h1 style={{fontSize: 22, margin: "0 0 8px"}}>
                Zulip Embed — Next.js example
            </h1>
            <p
                style={{
                    margin: "0 0 24px",
                    color: "#4b5563",
                    fontSize: 14,
                    lineHeight: 1.55,
                }}
            >
                This page is rendered on the server. The{" "}
                <code>&lt;zulip-chat&gt;</code> Web Component below lives inside a{" "}
                <code>&quot;use client&quot;</code> wrapper so custom-element
                registration only runs in the browser.
            </p>
            <ZulipClient />
        </main>
    );
}
