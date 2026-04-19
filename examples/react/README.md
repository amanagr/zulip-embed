# react

A minimal [Vite](https://vitejs.dev/) + React app that wires the
`<ZulipChat>` component from
[`zulip-embed-react`](https://www.npmjs.com/package/zulip-embed-react)
in demo mode.

## Run it

```sh
pnpm install --ignore-workspace
pnpm dev
```

Then open the URL Vite prints (usually
[http://localhost:5173/](http://localhost:5173/)).

> `--ignore-workspace` keeps pnpm from treating this folder as part of
> the surrounding repo's workspace. If you've copied the folder out of
> the repo, you can drop the flag.

## What's in here

- [`src/App.tsx`](./src/App.tsx) — renders `<ZulipChat demo .../>`.
  The `demo` prop swaps in an in-memory transport; no server or
  credentials required.
- [`src/main.tsx`](./src/main.tsx) — standard `createRoot` bootstrap.
- [`vite.config.ts`](./vite.config.ts) — standard `@vitejs/plugin-react`
  config.

`zulip-embed-react` is a **thin wrapper** around the framework-agnostic
`<zulip-chat>` Web Component. The wrapper:

- forwards camelCase React props as kebab-case HTML attributes,
- wires `onMessage` / `onConnectionChange` / `onError` to the
  underlying CustomEvents,
- side-effect-imports `zulip-embed` so the custom element registers on
  first render — no separate `import "zulip-embed"` needed.

## Connect to a real server

Drop `demo` and pass the live credentials. Read `apiKey` from
`import.meta.env.VITE_ZULIP_KEY` (or your preferred secret channel)
so you don't check it in:

```tsx
import {ZulipChat} from "zulip-embed-react";

export function App() {
    return (
        <ZulipChat
            server="https://chat.example.com"
            email="you@example.com"
            apiKey={import.meta.env.VITE_ZULIP_KEY}
            channel="general"
            topic="welcome"
            theme="light"
            mode="inline"
            brandName="Acme Support"
        />
    );
}
```

For production, prefer exchanging a short-lived JWT server-side and
passing it as `authToken` — that way no long-lived `apiKey` reaches
the browser.

## Headless alternative

If you want to build your own UI on top of the live client state,
`zulip-embed-react` also exports the `useZulipChat` hook:

```tsx
import {useMemo} from "react";
import {useZulipChat, ZulipClient} from "zulip-embed-react";
import {DemoTransport} from "zulip-embed/demo";

export function CustomChat() {
    const transport = useMemo(() => new DemoTransport(), []);
    const scope = useMemo(() => ({channel: "general"}), []);
    const {messages, status, sendMessage} = useZulipChat(transport, scope);
    // ...render your own UI around `messages`, `status`, `sendMessage`.
}
```

## Learn more

- [`zulip-embed-react` README](../../packages/react/README.md)
- [Top-level `README.md`](../../README.md)
