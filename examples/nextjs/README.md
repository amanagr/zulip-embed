# nextjs

A minimal [Next.js](https://nextjs.org/) App Router app that mounts
`<ZulipChat>` inside a `"use client"` wrapper — the canonical pattern
for SSR-safe Web Component usage.

## Run it

```sh
pnpm install --ignore-workspace
pnpm dev
```

Then open [http://localhost:3000/](http://localhost:3000/).

> `--ignore-workspace` keeps pnpm from treating this folder as part of
> the surrounding repo's workspace. If you've copied the folder out of
> the repo, you can drop the flag.

## The SSR subtlety

`<zulip-chat>` is a **Custom Element**. Custom elements only exist in
browsers — there is no `window`, no `customElements`, and no `HTMLElement`
in Node during `next build`. Running the registration code on the
server throws.

The `zulip-embed-react` wrapper already ships with a `"use client"`
directive at the top of its entry files, so importing `<ZulipChat>`
from a server component is technically fine — React will push the
whole wrapper subtree across the client boundary automatically. Still,
the recommended pattern is to add your own client wrapper:

```
app/
├── layout.tsx        # server component — static chrome
├── page.tsx          # server component — imports ZulipClient below
└── ZulipClient.tsx   # "use client" — renders <ZulipChat>
```

See [`app/page.tsx`](./app/page.tsx) (server) and
[`app/ZulipClient.tsx`](./app/ZulipClient.tsx) (client) in this
example.

The wrapper serves two purposes:

1. It makes the SSR boundary explicit and easy to find.
2. It gives you somewhere to co-locate client-only state (e.g. the
   current `channel` / `topic`) without marking the whole page client.

## Connect to a real server

Exchange a short-lived JWT on the server and pass it as `authToken`
to the client — no long-lived credentials travel to the browser. See
[`docs/jwt.md`](../../docs/jwt.md) for the exchange details.

```tsx
// app/ZulipClient.tsx
"use client";
import {ZulipChat} from "zulip-embed-react";

export function ZulipClient({authToken}: {authToken: string}) {
    return (
        <ZulipChat
            server="https://chat.example.com"
            authToken={authToken}
            channel="general"
            topic="welcome"
            theme="light"
            mode="inline"
            brandName="Acme Support"
        />
    );
}
```

## Learn more

- [`zulip-embed-react` README](../../packages/react/README.md)
- [Top-level `README.md`](../../README.md)
- [Next.js App Router client/server split](https://nextjs.org/docs/app/building-your-application/rendering/client-components)
