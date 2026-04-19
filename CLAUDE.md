# Conventions for Claude

## Terminology: prefer `channel` over `stream`

Zulip renamed **streams** to **channels** starting with Zulip 9 (October 2024).
In this codebase, always use `channel` / `Channel` / `channelName` /
`channelId` for types, variables, comments, docs, and public API surface —
**not** the legacy `stream` terminology.

Scope of the rule:

- **Internal types**: `Message.channelName`, `SendMessageParams.type: "channel"`, the `Channel` interface, `DEMO_CHANNELS`, etc.
- **Public API**: the SDK's exported types, attributes on `<zulip-chat>` (e.g. `channel="..."`), Flutter widget constructor params, and docs.
- **Tests, demos, READMEs**: all new prose and fixtures should say "channel."

### The wire format is the one exception

Outgoing calls to Zulip's REST API still send `"stream"` in a handful of
places where Zulip < 9 requires it:

- `buildNarrow()` emits `[["stream", channel]]` — Zulip < 9 rejects the
  `channel` alias on `/api/v1/register`.
- `sendMessage()` sends `type=stream` to `/api/v1/messages` — same reason.

Every supported Zulip server (including current stable) still accepts
`stream` on these endpoints, so hardcoding the legacy operator works
universally and avoids version sniffing. **Do not** "fix" these call sites
to use `channel` without first confirming that the oldest Zulip version the
embed is expected to connect to accepts the new form.

Each wire-level `"stream"` string should carry a short comment pointing
back to this note so a future reader sees the reason before being tempted
to rename it.

### Incoming normalization

When parsing server responses, accept both `"stream"` and `"channel"` on
`message.type` (the server currently emits `"stream"`, but Zulip 9+ may
start emitting `"channel"` in some contexts). Always normalize to
`"channel"` in the value we hand to SDK consumers — callers of this SDK
should never have to know that the server speaks the older dialect.

## Flutter vs. TypeScript parity

The Flutter package (`packages/flutter/`) and the TypeScript package
(`src/`) share the same domain model: `Transport` interface,
`DemoTransport`, `ZulipTransport`, `ZulipClient`, themed chat widget.
When you change the domain model in one, mirror the change in the other
so the SDKs don't drift.
