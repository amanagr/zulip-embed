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

Keys must not travel from the server component into the browser
bundle. Either:

- **Recommended:** exchange a short-lived JWT on the server and pass
  it as `authToken` to the client. `authToken` accepts a JWT minted
  against a Zulip account your server owns.
- **Quick prototype:** expose a prefixed env var
  (`NEXT_PUBLIC_ZULIP_KEY`) and wire it into the client component.
  Note this ships the key to every visitor.

```tsx
// app/ZulipClient.tsx
"use client";
import {ZulipChat} from "zulip-embed-react";

export function ZulipClient() {
    return (
        <ZulipChat
            server="https://chat.example.com"
            email="bot@example.com"
            apiKey={process.env.NEXT_PUBLIC_ZULIP_KEY}
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
