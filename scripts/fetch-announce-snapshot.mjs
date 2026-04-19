#!/usr/bin/env node
// Pull the latest ~30 messages from chat.zulip.org's #announce > Zulip
// updates topic and bake them into a JSON snapshot the demo site serves
// via <zulip-chat snapshot-url>. Credentials stay on the CI runner; no
// API key ever reaches the browser.
//
// Env vars (all required unless noted):
//   ZULIP_ANNOUNCE_EMAIL    — bot email
//   ZULIP_ANNOUNCE_API_KEY  — bot API key
//   ZULIP_ANNOUNCE_SERVER   — base URL, default https://chat.zulip.org
//   ZULIP_ANNOUNCE_CHANNEL  — default "announce"
//   ZULIP_ANNOUNCE_TOPIC    — default "Zulip updates"
//   ZULIP_ANNOUNCE_LIMIT    — default 30
//   ZULIP_ANNOUNCE_OUT      — default demo/public/snapshots/announce-zulip-updates.json
//
// Exits 0 on success; exits 1 on fetch/auth failure so CI can fall back
// to the checked-in snapshot in demo/snapshots/.

import {writeFile, mkdir} from "node:fs/promises";
import {dirname, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const email = process.env["ZULIP_ANNOUNCE_EMAIL"] ?? "";
const apiKey = process.env["ZULIP_ANNOUNCE_API_KEY"] ?? "";

// CI runs this step unconditionally so the workflow file doesn't need a
// secrets-guarded `if:` (which GitHub Actions rejects at validation
// time). When credentials aren't configured we exit 0 and leave the
// checked-in snapshot in place.
if (email === "" || apiKey === "") {
    console.log(
        "[fetch-snapshot] ZULIP_ANNOUNCE_EMAIL / ZULIP_ANNOUNCE_API_KEY not set — leaving checked-in snapshot in place.",
    );
    process.exit(0);
}
const serverRaw = process.env["ZULIP_ANNOUNCE_SERVER"] ?? "https://chat.zulip.org";
const channel = process.env["ZULIP_ANNOUNCE_CHANNEL"] ?? "announce";
const topic = process.env["ZULIP_ANNOUNCE_TOPIC"] ?? "Zulip updates";
const limit = Number(process.env["ZULIP_ANNOUNCE_LIMIT"] ?? "30");
const outPath = resolve(
    REPO_ROOT,
    process.env["ZULIP_ANNOUNCE_OUT"] ?? "demo/public/snapshots/announce-zulip-updates.json",
);
// Refuse to write outside the repo. `resolve` silently honors absolute
// paths and `..` traversal, so a typo (or a malicious workflow edit)
// could otherwise point this at /etc/anything.
if (outPath !== REPO_ROOT && !outPath.startsWith(REPO_ROOT + sep)) {
    console.error(`[fetch-snapshot] refusing to write outside the repo: ${outPath}`);
    process.exit(1);
}

const server = serverRaw.replace(/\/+$/, "");
const authHeader = "Basic " + Buffer.from(`${email}:${apiKey}`, "utf-8").toString("base64");

// Two-element narrow form with the legacy "stream" operator — every
// supported Zulip version accepts it (see CLAUDE.md for why we don't send
// "channel" here).
const narrow = JSON.stringify([
    ["stream", channel],
    ["topic", topic],
]);

const url = new URL(`${server}/api/v1/messages`);
url.searchParams.set("anchor", "newest");
url.searchParams.set("num_before", String(limit));
url.searchParams.set("num_after", "0");
url.searchParams.set("narrow", narrow);
url.searchParams.set("apply_markdown", "true");
url.searchParams.set("client_gravatar", "true");

console.log(`[fetch-snapshot] GET ${url.toString()}`);

const response = await fetch(url, {headers: {Authorization: authHeader}});
if (!response.ok) {
    const body = await response.text();
    console.error(`[fetch-snapshot] HTTP ${String(response.status)}: ${body.slice(0, 400)}`);
    // Zulip returns a specific 401 code for incoming-webhook bots that
    // try to read messages. Point maintainers at the fix so they don't
    // have to dig through API docs.
    if (body.includes("not available to incoming webhook bots")) {
        console.error(
            "[fetch-snapshot] The configured API key belongs to an 'incoming webhook' bot, which can only POST messages. Create a 'generic' bot in Zulip (Personal settings → Bots → Add a new bot → type=Generic bot), subscribe it to the channel, and use its API key instead.",
        );
    }
    process.exit(1);
}

const payload = await response.json();
const rawMessages = Array.isArray(payload.messages) ? payload.messages : [];
if (rawMessages.length === 0) {
    console.error("[fetch-snapshot] server returned 0 messages; refusing to overwrite snapshot");
    process.exit(1);
}

const messages = rawMessages.map(convertMessage);

const snapshot = {
    version: 1,
    generatedAt: Date.now(),
    server,
    channel,
    topic,
    messages,
};

await mkdir(dirname(outPath), {recursive: true});
await writeFile(outPath, JSON.stringify(snapshot, null, 2) + "\n", "utf-8");
console.log(`[fetch-snapshot] wrote ${String(messages.length)} messages → ${outPath}`);

// Minimal re-implementation of the TS convertMessage. Kept inline so this
// script has no build step and runs straight on Node 22.
function convertMessage(api) {
    const isChannelMessage = api.type === "stream" || api.type === "channel";
    const channelName =
        isChannelMessage && typeof api.display_recipient === "string"
            ? api.display_recipient
            : undefined;

    const reactionsByEmoji = new Map();
    for (const r of api.reactions ?? []) {
        let bucket = reactionsByEmoji.get(r.emoji_name);
        if (!bucket) {
            bucket = {emoji: r.emoji_name, userIds: new Set()};
            reactionsByEmoji.set(r.emoji_name, bucket);
        }
        bucket.userIds.add(r.user_id);
    }

    return {
        id: api.id,
        senderId: api.sender_id,
        senderFullName: api.sender_full_name,
        senderEmail: api.sender_email,
        avatarUrl: api.avatar_url ?? "",
        timestamp: api.timestamp * 1000,
        content: api.content,
        contentIsHtml: true,
        type: isChannelMessage ? "channel" : "direct",
        channelName,
        topic: api.subject,
        reactions: [...reactionsByEmoji.values()].map((bucket) => ({
            emoji: bucket.emoji,
            count: bucket.userIds.size,
            userIds: [...bucket.userIds],
        })),
    };
}
