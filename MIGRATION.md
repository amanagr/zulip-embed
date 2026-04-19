# Migration guide

Per-release upgrade notes for `zulip-embed` and its sibling packages.
Each section covers the change, the before/after shape, and any host
code you'll need to touch.

Older per-release migrations:

- [`docs/migration-0.2.md`](./docs/migration-0.2.md) — 0.1 → 0.2:
  JWT handoff, discriminated-union `Message` / `SendMessageParams` /
  `EditMessageParams`, typed `ErrorEvent.code`, `whenReady`, and the
  new `"reconnecting"` connection state.

See [`CHANGELOG.md`](./CHANGELOG.md) for the full release log and
[`docs/RELEASING.md`](./docs/RELEASING.md) for the release workflow.

## 0.7 → 0.8

**No breaking changes.** 0.8 is additive over 0.7: every 0.7 call
site keeps compiling against 0.8 unchanged. Adopt the pieces below
at your own pace.

### 1. Per-entry imports (optional, recommended)

0.8 ships a subpath-exports map so you can cherry-pick the custom
elements and helpers you actually render. The default
`import "zulip-embed"` still registers everything — keep it if you
want the smallest diff.

**Before (0.7).** Every page paid for every element.

```ts
import "zulip-embed";
// <zulip-chat>, <zulip-channel-list>, <zulip-topic-list>, and every
// helper are all in the bundle.
```

**After (0.8).** Import only what you mount.

```ts
import "zulip-embed/chat"; // registers <zulip-chat>
import "zulip-embed/channel-list"; // registers <zulip-channel-list>
// no <zulip-topic-list> in the bundle
```

Subpaths wired in `package.json` `exports`:

| Subpath                    | Registers                              |
| -------------------------- | -------------------------------------- |
| `zulip-embed/chat`         | `<zulip-chat>`                         |
| `zulip-embed/channel-list` | `<zulip-channel-list>`                 |
| `zulip-embed/topic-list`   | `<zulip-topic-list>`                   |
| `zulip-embed/announcement` | `<zulip-announcement>` (new in 0.8)    |
| `zulip-embed/agent`        | `startAgentReply` + `AgentReplyHandle` |
| `zulip-embed/demo`         | `DemoTransport`, `SnapshotTransport`   |
| `zulip-embed/all`          | register-everything shim (same as `.`) |

Per-subpath gzip budgets are documented in
[`README.md#bundle-subpaths`](./README.md#bundle-subpaths) and
enforced in CI by `scripts/bundle-check.mjs`.

The unpkg `<script type="module" src="https://unpkg.com/zulip-embed">`
path still resolves to the IIFE build and registers every element, so
the Track 1 (vanilla HTML) snippet in the README keeps working.

### 2. `<zulip-announcement>` (new element)

A small pinned-banner element that fetches a single message by id and
renders it as a dismissible banner above the main embed. Useful for
product announcements, changelogs, or "read the docs" nudges that you
author as a Zulip message.

Opt in by importing the subpath entry and dropping the tag onto the
page:

```html
<script type="module" src="./node_modules/zulip-embed/dist/entries/announcement.js"></script>

<zulip-announcement
    server="https://chat.example.com"
    email="bot@example.com"
    api-key="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    message-id="4271"
    theme="light"
></zulip-announcement>
```

Attributes mirror the credential attributes on `<zulip-chat>`
(`server`, `email`, `api-key`, or `auth-token` in production) plus:

| Attribute     | Required | Description                                                                  |
| ------------- | -------- | ---------------------------------------------------------------------------- |
| `message-id`  | yes      | Zulip message id to fetch and render.                                        |
| `dismissible` | no       | `true` (default) or `false`. When `false`, the close button is not rendered. |
| `theme`       | no       | `light` (default) or `dark`.                                                 |

Listen for dismissal on the host:

```js
document.querySelector("zulip-announcement").addEventListener("announcement-dismissed", (event) => {
    // event.detail.messageId — the id that was dismissed.
    localStorage.setItem(`ann-dismissed-${event.detail.messageId}`, "1");
});
```

Flutter gets the same widget as `ZulipAnnouncement` in
`package:zulip_embed/zulip_embed.dart`.

### 3. React Native (alpha)

`zulip-embed-react-native@0.8.0-rc.0-alpha` adds React Native bindings.
This is an **alpha preview** — plain-text rendering only, no reactions
/ typing / message-action UI in the bundled `<ZulipChatScreen>`. The
headless `ZulipClient` works end-to-end and is the supported path for
any UI richer than the default screen.

```bash
npm i zulip-embed zulip-embed-react-native
```

```tsx
import {ZulipChatScreen, ZulipTransport, DARK_THEME} from "zulip-embed-react-native";

const transport = new ZulipTransport({
    server: "https://chat.example.com",
    email: "you@example.com",
    apiKey: process.env.ZULIP_KEY!,
    scope: {channel: "general"},
});

export default function SupportScreen() {
    return (
        <ZulipChatScreen
            transport={transport}
            scope={{channel: "general"}}
            theme={DARK_THEME}
            brandName="Acme Support"
        />
    );
}
```

Expect churn. The alpha banner is intentional — the package logs a
one-time `console.warn` in `__DEV__` when `<ZulipChatScreen>` mounts so
you don't miss the status. See
[`packages/react-native/README.md`](./packages/react-native/README.md)
for the full "in vs. not in the widget" matrix and the headless-client
fallback pattern.

### 4. SRI verification for CDN-loaded bundles

Every tagged release ships a subresource-integrity manifest at
`dist/INTEGRITY.{json,md}`. To pin a bundle against CDN tampering,
copy the SRI tag for the entry you load and paste it into your
`<script integrity="...">` attribute:

```html
<script
    type="module"
    src="https://unpkg.com/zulip-embed@0.8.0/dist/zulip-embed.iife.js"
    integrity="sha256-<copy from dist/INTEGRITY.md for the 0.8.0 tag>"
    crossorigin="anonymous"
></script>
```

The README's "Verified releases" section hosts the current hashes
— CI splices them in automatically on tag push via
`scripts/splice-sri.mjs`. For unreleased `main`, regenerate locally
with `pnpm build && node scripts/release.mjs` and read
`dist/INTEGRITY.md`.

npm consumers get Sigstore provenance for free — every publishable
workspace has `publishConfig.provenance: true`, so
`npm view zulip-embed dist.signatures` shows the attestation chain
for the tarball.

### 5. No code changes required

Summary for anyone upgrading: bump `zulip-embed` and the wrapper
packages, re-run your builds, and you're done. Nothing in the 0.7
public API was removed or reshaped. The subpath imports,
`<zulip-announcement>`, RN, and SRI pinning are all opt-in.

## 0.8 → 1.0 (planned)

Additional surfaces land in 1.0 — `<zulip-dm-list>`, gradient avatars,
starter chips, and first-class typing indicators on the RN widget.
Migration notes will be written when 1.0 cuts.

**`ScopeFilter` may widen to a discriminated union** so DMs get a
first-class scope shape alongside channels:

```ts
// Possible 1.0 shape:
type ScopeFilter =
    | {type: "channel"; channel: string; topic?: string}
    | {type: "dm"; userIds: number[]};
```

Existing call sites that pass `{channel, topic}` will stay
back-compat through a `normalizeScope(input: LegacyScopeFilter |
ScopeFilter): ScopeFilter` helper. Consumers that read `.channel` /
`.topic` off a `ScopeFilter` value directly will need to narrow on
`type` first; `tsc` will flag every call site when the union lands.

The `api-key` attribute's 1.0-removal deadline still stands — see
[`docs/migration-0.2.md`](./docs/migration-0.2.md) for the
recommended `auth-token` flow. Production deployments should have
migrated by 1.0.
