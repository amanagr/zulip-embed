// Core transports return message.content as HTML when contentIsHtml is
// true. RN can't render HTML safely without a native bridge, so we
// strip tags and decode the entities Zulip commonly emits. For richer
// rendering, a host app can wrap ZulipChatScreen and render the raw
// content string through their preferred Markdown/HTML view.
//
// Iterate strip-then-decode until it stabilizes. The naive order —
// strip tags first, then decode `&lt;` / `&gt;` — lets a payload like
// `&lt;script&gt;alert(1)&lt;/script&gt;` pass through tag stripping
// (no literal angle brackets) and emerge from decoding as
// `<script>alert(1)</script>` — harmless in RN's <Text>, but the
// attacker-controlled text reads as a script tag and can mislead a
// host that routes the value into any HTML-capable sink. Running the
// strip pass after each decode round neutralizes both single- and
// double-encoded payloads.
export function stripHtml(raw: string): string {
    let current = raw;
    for (let i = 0; i < 4; i++) {
        const stripped = current
            .replace(/<[^>]*>/g, "")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
        if (stripped === current) break;
        current = stripped;
    }
    return current.replace(/<[^>]*>/g, "").trim();
}
