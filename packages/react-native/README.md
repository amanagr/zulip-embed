# zulip-embed-react-native

React Native wrappers + headless SDK for Zulip.

> **Status — `0.8.0-rc.0-alpha` preview.** The RN package is an
> **alpha preview** of the v0.8 surface. It is intentionally narrower
> than the web and Flutter packages: messages render as plain text
> (no Markdown / mentions / reactions UI), and some `Transport`
> capabilities (typing, reactions, edit/delete) are not wired into
> `<ZulipChatScreen>` yet. The headless `ZulipClient` works end-to-end;
> the widget is a minimal reference implementation you are expected to
> fork or skin.
>
> API for this package may move before 1.0 without a major-version bump.

## What's in the box

- `<ZulipChatScreen>` — a `FlatList` + `TextInput` + `KeyboardAvoidingView`
  chat screen. Plain-text rendering. Light + dark themes.
- `ZulipClient` — the full headless client re-exported from
  `zulip-embed`. Works in RN out of the box because it is DOM-free.
- `DemoTransport`, `ZulipTransport` — transports re-exported from
  `zulip-embed`. `ZulipTransport` uses `fetch` and works under
  Hermes / Metro with no polyfills.
- Typed re-exports of every public domain type (`Message`,
  `ScopeFilter`, `SendMessageParams`, …) so apps depend on one package.

## What's **not** in the box (yet)

These ship in the web and Flutter packages but are not in this
alpha preview:

- Markdown / rich-text rendering. `message.content` is surfaced via a
  minimal `stripHtml()` and rendered as `<Text>`.
- Reaction picker UI. (Reactions on incoming messages are parsed but
  not displayed.)
- Typing indicators, edit/delete UI, message-action menu.
- Channel list / topic list / DM list / announcement widgets.

These are tracked for v1.0 — see the roadmap in the root
[`README.md`](../../README.md). For now, consumers who need any of
these should use the headless `ZulipClient` + build their own UI on
top, or the web `<zulip-chat>` element inside a `WebView`.

## Install

```bash
pnpm add zulip-embed zulip-embed-react-native
# or
npm i zulip-embed zulip-embed-react-native
```

Peer deps: `react >= 17`, `react-native >= 0.70`, `zulip-embed >= 0.8.0-rc.0`.

## Quick start

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

### Demo mode (no credentials)

```tsx
import {ZulipChatScreen, DemoTransport} from "zulip-embed-react-native";

const transport = new DemoTransport();

export default function DemoScreen() {
    return (
        <ZulipChatScreen
            transport={transport}
            scope={{channel: "general"}}
            readOnly
        />
    );
}
```

## Alpha runtime warning

The package logs a one-time `console.warn` in development
(`__DEV__ === true`) when `<ZulipChatScreen>` mounts so app authors
notice the alpha status even if they skipped this README. The warning
is silent in production.

## License

Apache-2.0. See [`LICENSE`](../../LICENSE).
