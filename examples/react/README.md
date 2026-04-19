# react

A minimal [Vite](https://vitejs.dev/) + React app that wires the
`<ZulipChat>` component from
[`zulip-embed-react`](https://github.com/amanagr/zulip-embed/tree/main/packages/react)
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

Drop `demo` and pass a short-lived JWT minted by your backend (see
[`docs/jwt.md`](../../docs/jwt.md)):

```tsx
import {ZulipChat} from "zulip-embed-react";

export function App() {
    return (
        <ZulipChat
            server="https://chat.example.com"
            authToken={import.meta.env.VITE_ZULIP_AUTH_TOKEN}
            channel="general"
            topic="welcome"
            theme="light"
            mode="inline"
            brandName="Acme Support"
        />
    );
}
```

`authToken` is a JWT your backend signs with the shared secret
provisioned in the Zulip org's `JWT_AUTH_KEYS`. The SDK exchanges it
once for a scoped API key — no long-lived credentials touch the page.

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
