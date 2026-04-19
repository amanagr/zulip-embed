#!/usr/bin/env node
// Pull the viewer's subscribed channels and each channel's topic list
// from chat.zulip.org and bake them into a read-only JSON snapshot the
// demo site serves via `<zulip-channel-list snapshot-url>` and
// `<zulip-topic-list snapshot-url>`. Credentials stay on the CI runner;
// no API key ever reaches the browser.
//
// Env vars (reuses the same bot the announce-snapshot fetcher uses):
//   ZULIP_ANNOUNCE_EMAIL      — bot email
//   ZULIP_ANNOUNCE_API_KEY    — bot API key
//   ZULIP_ANNOUNCE_SERVER     — base URL, default https://chat.zulip.org
//   ZULIP_CHANNELS_MAX_CHAN   — cap on channels to enumerate (default 12,
//                               keeps the snapshot small and the API bill low)
//   ZULIP_CHANNELS_MAX_TOPIC  — cap on topics per channel (default 30)
//   ZULIP_CHANNELS_OUT        — default demo/public/snapshots/chat-zulip-channels.json
//
// Exits 0 on success or when credentials are absent (CI falls back to
// the checked-in snapshot). Exits 1 on auth / HTTP failure so the
// workflow surfaces the problem without silently deploying stale data.

import {writeFile, mkdir} from "node:fs/promises";
import {dirname, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const email = process.env["ZULIP_ANNOUNCE_EMAIL"] ?? "";
const apiKey = process.env["ZULIP_ANNOUNCE_API_KEY"] ?? "";

if (email === "" || apiKey === "") {
    console.log(
        "[fetch-channels] ZULIP_ANNOUNCE_EMAIL / ZULIP_ANNOUNCE_API_KEY not set — leaving checked-in snapshot in place.",
    );
    process.exit(0);
}

const serverRaw = process.env["ZULIP_ANNOUNCE_SERVER"] ?? "https://chat.zulip.org";
const maxChannels = Number(process.env["ZULIP_CHANNELS_MAX_CHAN"] ?? "12");
const maxTopics = Number(process.env["ZULIP_CHANNELS_MAX_TOPIC"] ?? "30");
const outPath = resolve(
    REPO_ROOT,
    process.env["ZULIP_CHANNELS_OUT"] ??
        "demo/public/snapshots/chat-zulip-channels.json",
);
if (outPath !== REPO_ROOT && !outPath.startsWith(REPO_ROOT + sep)) {
    console.error(`[fetch-channels] refusing to write outside the repo: ${outPath}`);
    process.exit(1);
}

const server = serverRaw.replace(/\/+$/, "");
const authHeader =
    "Basic " + Buffer.from(`${email}:${apiKey}`, "utf-8").toString("base64");

console.log(`[fetch-channels] GET ${server}/api/v1/users/me/subscriptions`);
const subsResp = await fetch(`${server}/api/v1/users/me/subscriptions`, {
    headers: {Authorization: authHeader},
});
if (!subsResp.ok) {
    const body = await subsResp.text();
    console.error(`[fetch-channels] subscriptions HTTP ${String(subsResp.status)}: ${body.slice(0, 400)}`);
    process.exit(1);
}
const subsPayload = await subsResp.json();
const subs = Array.isArray(subsPayload.subscriptions) ? subsPayload.subscriptions : [];
if (subs.length === 0) {
    console.error("[fetch-channels] subscriptions returned 0 rows; refusing to overwrite snapshot");
    process.exit(1);
}

// Pinned-first alphabetical — same ordering ZulipTransport.listChannels
// applies at runtime, so the on-disk order matches what the component
// would render from a live connection.
subs.sort((a, b) => {
    if (Boolean(a.pin_to_top) !== Boolean(b.pin_to_top)) {
        return a.pin_to_top ? -1 : 1;
    }
    return String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase());
});

const trimmed = subs.slice(0, Math.max(1, maxChannels));
const channels = trimmed.map((s) => ({
    channelId: s.stream_id,
    name: s.name,
    description: typeof s.description === "string" ? s.description : "",
    color: typeof s.color === "string" ? s.color : undefined,
    pinToTop: Boolean(s.pin_to_top),
    isMuted: Boolean(s.is_muted),
    unreadCount: 0,
}));

// Topics: hit /users/me/{stream_id}/topics per channel. Each response is
// {topics: [{name, max_id}, ...]}; we strip the U+2714 resolved-topic
// prefix the same way ZulipTransport.listTopics does so the component's
// isResolved flag renders consistently.
const RESOLVED_PREFIX = "\u2714 ";
const topics = {};
for (const c of channels) {
    console.log(`[fetch-channels] GET ${server}/api/v1/users/me/${String(c.channelId)}/topics`);
    const tResp = await fetch(
        `${server}/api/v1/users/me/${String(c.channelId)}/topics`,
        {headers: {Authorization: authHeader}},
    );
    if (!tResp.ok) {
        const body = await tResp.text();
        console.warn(
            `[fetch-channels] topics HTTP ${String(tResp.status)} for #${c.name}: ${body.slice(0, 200)} — skipping channel`,
        );
        continue;
    }
    const body = await tResp.json();
    const rows = Array.isArray(body.topics) ? body.topics : [];
    rows.sort((a, b) => Number(b.max_id) - Number(a.max_id));
    topics[c.name] = rows.slice(0, Math.max(1, maxTopics)).map((t) => {
        const raw = typeof t.name === "string" ? t.name : "";
        const resolved = raw.startsWith(RESOLVED_PREFIX);
        return {
            name: resolved ? raw.slice(RESOLVED_PREFIX.length) : raw,
            maxMessageId: Number(t.max_id),
            unreadCount: 0,
            isResolved: resolved,
        };
    });
}

// The SnapshotFile schema requires `channel` + `messages` even on
// navigation-only snapshots. Point them at the first channel we fetched
// and an empty message array so the file stays valid without needing a
// second /messages round trip.
const snapshot = {
    version: 1,
    generatedAt: Date.now(),
    server,
    channel: channels[0]?.name ?? "general",
    messages: [],
    channels,
    topics,
};

await mkdir(dirname(outPath), {recursive: true});
await writeFile(outPath, JSON.stringify(snapshot, null, 2) + "\n", "utf-8");
console.log(
    `[fetch-channels] wrote ${String(channels.length)} channels + topics → ${outPath}`,
);
