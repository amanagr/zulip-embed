import type {Channel, ChannelMessage, Reaction, User} from "./types.ts";

const AVATAR_PLACEHOLDER = "";

export const DEMO_GUEST_USER: User = {
    userId: 1000,
    email: "you@example.com",
    fullName: "You",
    avatarUrl: AVATAR_PLACEHOLDER,
};

export const DEMO_USERS: User[] = [
    DEMO_GUEST_USER,
    {
        userId: 11,
        email: "iago@zulip.com",
        fullName: "Iago",
        avatarUrl: AVATAR_PLACEHOLDER,
    },
    {
        userId: 12,
        email: "hamlet@zulip.com",
        fullName: "King Hamlet",
        avatarUrl: AVATAR_PLACEHOLDER,
    },
    {
        userId: 13,
        email: "cordelia@zulip.com",
        fullName: "Cordelia, Lear's daughter",
        avatarUrl: AVATAR_PLACEHOLDER,
    },
    {
        userId: 14,
        email: "zulip-bot@example.com",
        fullName: "Zulip Bot",
        avatarUrl: AVATAR_PLACEHOLDER,
    },
    {
        userId: 15,
        email: "prospero@zulip.com",
        fullName: "Prospero from The Tempest",
        avatarUrl: AVATAR_PLACEHOLDER,
    },
];

export const DEMO_CHANNELS: Channel[] = [
    {channelId: 1, name: "general", description: "Say hello to the team"},
    {channelId: 2, name: "announce", description: "Official releases and announcements"},
    {channelId: 3, name: "showcase", description: "Every rendering feature in one place"},
    {channelId: 4, name: "design", description: "Mocks, critiques, and color debates"},
    {channelId: 5, name: "support", description: "Ask questions, share bugs"},
];

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

interface SeedOptions {
    id: number;
    senderEmail: string;
    channel: string;
    topic: string;
    content: string;
    contentIsHtml?: boolean;
    minutesAgo: number;
    reactions?: Reaction[];
}

function demoMessage(opts: SeedOptions): ChannelMessage {
    const sender = DEMO_USERS.find((u) => u.email === opts.senderEmail);
    if (sender === undefined) {
        throw new Error(`Unknown demo sender: ${opts.senderEmail}`);
    }
    return {
        id: opts.id,
        senderId: sender.userId,
        senderFullName: sender.fullName,
        senderEmail: sender.email,
        avatarUrl: sender.avatarUrl,
        timestamp: Date.now() - opts.minutesAgo * MINUTE,
        content: opts.content,
        contentIsHtml: opts.contentIsHtml ?? false,
        type: "channel",
        channelName: opts.channel,
        topic: opts.topic,
        reactions: opts.reactions ?? [],
    };
}

function reaction(emoji: string, userIds: number[]): Reaction {
    return {emoji, count: userIds.length, userIds};
}

// Renders a <#channel> mention the way Zulip's markdown renderer emits it.
function channelMention(name: string): string {
    return `<a class="stream" data-stream-id="1" href="#narrow/channel/${name}">#${name}</a>`;
}

function userMention(name: string, me = false): string {
    const cls = me ? "user-mention user-mention-me" : "user-mention";
    return `<span class="${cls}" data-user-id="0">@${name}</span>`;
}

export function seedMessages(channel: string, topic: string | undefined): ChannelMessage[] {
    if (channel === "announce") {
        return announceSeed(topic ?? "server releases");
    }
    if (channel === "showcase") {
        return showcaseSeed(topic ?? "rendering");
    }
    return generalSeed(channel, topic ?? "welcome");
}

function generalSeed(channel: string, topic: string): ChannelMessage[] {
    return [
        demoMessage({
            id: 101,
            senderEmail: "iago@zulip.com",
            channel,
            topic,
            minutesAgo: 45,
            content:
                "Welcome to the Zulip embed demo! This chat is powered by an in-memory transport, so nothing leaves your browser.",
        }),
        demoMessage({
            id: 102,
            senderEmail: "hamlet@zulip.com",
            channel,
            topic,
            minutesAgo: 30,
            content: "Try sending a message — Zulip Bot will echo it back after a moment.",
            reactions: [reaction("wave", [13, 15])],
        }),
        demoMessage({
            id: 103,
            senderEmail: "cordelia@zulip.com",
            channel,
            topic,
            minutesAgo: 15,
            content:
                "Topics in Zulip let each conversation stay focused. This one is pinned to the topic shown in the header.",
        }),
        demoMessage({
            id: 104,
            senderEmail: "zulip-bot@example.com",
            channel,
            topic,
            minutesAgo: 2,
            content: "Ready when you are!",
            reactions: [reaction("tada", [11, 12, 13])],
        }),
    ];
}

// Mirrors Zulip's own #announce channel: release notes, outage post-mortems,
// GitHub-style changelogs. Read-only in the demo — users react but don't
// reply.
function announceSeed(topic: string): ChannelMessage[] {
    return [
        demoMessage({
            id: 201,
            senderEmail: "iago@zulip.com",
            channel: "announce",
            topic,
            minutesAgo: 7 * DAY / MINUTE,
            contentIsHtml: true,
            content: `
<h2>Zulip Server 9.4 released</h2>
<p>Maintenance release with bug fixes and security improvements for the 9.x line.
Full notes are on the <a href="https://zulip.readthedocs.io/en/latest/overview/changelog.html">changelog</a>.</p>
<p><strong>Highlights:</strong></p>
<ul>
  <li>Fix a rare race in the push-notifications bouncer.</li>
  <li>Speed up <code>/api/v1/register</code> for very large organizations.</li>
  <li>Channels renamed from "streams" in the UI; API aliases are stable.</li>
</ul>
<p>Upgrade with:</p>
<pre><code class="language-bash">/home/zulip/deployments/current/scripts/upgrade-zulip-from-git 9.4</code></pre>
<p>Thanks to ${userMention("Cordelia, Lear's daughter")} and ${userMention("Prospero from The Tempest")} for the release review.</p>`,
            reactions: [
                reaction("tada", [12, 13, 15, 1000]),
                reaction("rocket", [11, 12]),
            ],
        }),
        demoMessage({
            id: 202,
            senderEmail: "hamlet@zulip.com",
            channel: "announce",
            topic,
            minutesAgo: 3 * DAY / MINUTE,
            contentIsHtml: true,
            content: `
<h2>Zulip Server 10.0 beta 2</h2>
<p>The second beta of the 10.x line is available. Production deployments should stay on 9.x; this build is for <em>testing</em>.</p>
<p><strong>What's new since beta 1:</strong></p>
<ol>
  <li>Composer now supports <code>Ctrl+Shift+C</code> to insert a code block.</li>
  <li>Topic search understands <code>has:reaction</code>.</li>
  <li>Fixed ${channelMention("announce")} notifications failing on very wide
      terminals (<a href="https://github.com/zulip/zulip/issues/29912">#29912</a>).</li>
</ol>
<blockquote>
  <p>Please file issues on GitHub — beta feedback is <em>much</em> more useful than "it worked for me" reactions here.</p>
</blockquote>`,
            reactions: [
                reaction("eyes", [11, 13, 15]),
                reaction("bug", [12]),
            ],
        }),
        demoMessage({
            id: 203,
            senderEmail: "prospero@zulip.com",
            channel: "announce",
            topic,
            minutesAgo: 6 * HOUR / MINUTE,
            contentIsHtml: true,
            content: `
<h2>Post-mortem: push notifications outage (2026-04-17)</h2>
<p>Between <strong>04-17 14:02 UTC</strong> and <strong>04-17 15:48 UTC</strong>, the hosted push-notifications bouncer returned 5xx for roughly 6% of requests.</p>
<p><strong>Root cause.</strong> A connection-pool setting in the bouncer was scaled for the old traffic pattern; the 9.4 rollout shifted more servers to long-lived queues, which starved the pool under load.</p>
<p><strong>Resolution.</strong> We doubled the pool size, reran the load tests, and added alerting that fires before saturation rather than after.</p>
<p>Impacted operators should see notifications flowing normally again. If you still see drops, reply in ${channelMention("support")} with your server's <code>server_uuid</code>.</p>
<table>
  <thead><tr><th>Metric</th><th>Peak</th><th>Normal</th></tr></thead>
  <tbody>
    <tr><td>p99 latency</td><td>8.4s</td><td>180ms</td></tr>
    <tr><td>Error rate</td><td>6.1%</td><td>&lt; 0.01%</td></tr>
  </tbody>
</table>`,
            reactions: [
                reaction("pray", [11, 12, 13, 1000]),
                reaction("heart", [12, 15]),
            ],
        }),
    ];
}

// "One of each" showcase: every renderer feature we claim to support shows
// up in at least one message. Inspired by Zulip's populate_db fixtures.
function showcaseSeed(topic: string): ChannelMessage[] {
    return [
        demoMessage({
            id: 301,
            senderEmail: "iago@zulip.com",
            channel: "showcase",
            topic,
            minutesAgo: 120,
            contentIsHtml: true,
            content: `
<p><strong>Bold</strong>, <em>italic</em>, <del>strikethrough</del>, <u>underline</u>, and <code>inline code</code>.
Also a <a href="https://zulip.com">link</a> and an autolinked URL: <a href="https://zulip.readthedocs.io">https://zulip.readthedocs.io</a>.</p>`,
            reactions: [reaction("sparkles", [12, 13])],
        }),
        demoMessage({
            id: 302,
            senderEmail: "hamlet@zulip.com",
            channel: "showcase",
            topic,
            minutesAgo: 110,
            contentIsHtml: true,
            content: `
<p>Unordered list:</p>
<ul>
  <li>First item</li>
  <li>Second item with <code>code</code> inside</li>
  <li>Nested:
    <ul><li>child a</li><li>child b</li></ul>
  </li>
</ul>
<p>Ordered list:</p>
<ol>
  <li>Clone the repo</li>
  <li>Install deps</li>
  <li>Ship it <span class="emoji">🚢</span></li>
</ol>`,
        }),
        demoMessage({
            id: 303,
            senderEmail: "cordelia@zulip.com",
            channel: "showcase",
            topic,
            minutesAgo: 90,
            contentIsHtml: true,
            content: `
<p>Quoted reply:</p>
<blockquote>
  <p>${userMention("King Hamlet")} said:</p>
  <p>Ship it <span class="emoji">🚢</span></p>
</blockquote>
<p>Sounds good — merging.</p>`,
            reactions: [reaction("+1", [11, 12, 15])],
        }),
        demoMessage({
            id: 304,
            senderEmail: "prospero@zulip.com",
            channel: "showcase",
            topic,
            minutesAgo: 75,
            contentIsHtml: true,
            content: `
<p>Code block with syntax highlighting:</p>
<div class="codehilite"><pre><span></span><code class="language-python"><span class="k">def</span> <span class="nf">greet</span><span class="p">(</span><span class="n">name</span><span class="p">:</span> <span class="nb">str</span><span class="p">)</span> <span class="o">-&gt;</span> <span class="nb">str</span><span class="p">:</span>
    <span class="sd">&quot;&quot;&quot;Return a friendly greeting.&quot;&quot;&quot;</span>
    <span class="k">return</span> <span class="sa">f</span><span class="s2">&quot;Hello, </span><span class="si">{</span><span class="n">name</span><span class="si">}</span><span class="s2">!&quot;</span>

<span class="k">if</span> <span class="vm">__name__</span> <span class="o">==</span> <span class="s2">&quot;__main__&quot;</span><span class="p">:</span>
    <span class="nb">print</span><span class="p">(</span><span class="n">greet</span><span class="p">(</span><span class="s2">&quot;Zulip&quot;</span><span class="p">))</span>
</code></pre></div>
<p>Keyboard shortcut: <kbd>Ctrl</kbd> + <kbd>Enter</kbd>.</p>`,
        }),
        demoMessage({
            id: 305,
            senderEmail: "iago@zulip.com",
            channel: "showcase",
            topic,
            minutesAgo: 60,
            contentIsHtml: true,
            content: `
<p>Table:</p>
<table>
  <thead><tr><th>Feature</th><th>v0.1</th><th>v0.2</th></tr></thead>
  <tbody>
    <tr><td>Rich rendering</td><td>✅</td><td>✅</td></tr>
    <tr><td>Reactions</td><td>✅</td><td>✅</td></tr>
    <tr><td>Threads</td><td>—</td><td>✅</td></tr>
  </tbody>
</table>
<hr>
<h3>Heading three</h3>
<h4>Heading four</h4>`,
        }),
        demoMessage({
            id: 306,
            senderEmail: "hamlet@zulip.com",
            channel: "showcase",
            topic,
            minutesAgo: 45,
            contentIsHtml: true,
            content: `
<p>Mentions and references:</p>
<ul>
  <li>User: ${userMention("Cordelia, Lear's daughter")}</li>
  <li>You: ${userMention("you", true)}</li>
  <li>Channel: ${channelMention("general")}</li>
  <li>Channel + topic:
    <a class="stream-topic" href="#narrow/channel/announce/topic/server.20releases">#announce &gt; server releases</a></li>
</ul>`,
            reactions: [reaction("eyes", [12, 13])],
        }),
        demoMessage({
            id: 307,
            senderEmail: "cordelia@zulip.com",
            channel: "showcase",
            topic,
            minutesAgo: 30,
            contentIsHtml: true,
            content: `
<p>Inline image (served over HTTPS):</p>
<p><img src="https://zulip.com/static/images/logo/zulip-org-logo.svg" alt="Zulip logo"></p>`,
            reactions: [reaction("heart", [11, 15, 1000])],
        }),
        demoMessage({
            id: 308,
            senderEmail: "zulip-bot@example.com",
            channel: "showcase",
            topic,
            minutesAgo: 10,
            contentIsHtml: true,
            content: `
<p>Spoiler-style quote and heading levels:</p>
<blockquote><p>The answer is <strong>42</strong>.</p></blockquote>
<h1>H1</h1>
<h2>H2</h2>
<h5>H5</h5>
<h6>H6</h6>`,
        }),
        demoMessage({
            id: 309,
            senderEmail: "zulip-bot@example.com",
            channel: "showcase",
            topic,
            minutesAgo: 8,
            contentIsHtml: true,
            content: `
<p>Click the spoiler below to reveal the twist:</p>
<div class="spoiler-block"><div class="spoiler-header"><p>Ending of the novel</p></div><div class="spoiler-content" aria-hidden="true"><p>It was <strong>Zulip all along</strong>.</p></div></div>`,
        }),
    ];
}
