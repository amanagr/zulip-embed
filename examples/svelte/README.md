# svelte

A minimal [Vite](https://vitejs.dev/) + Svelte 5 app that mounts the
framework-agnostic `<zulip-chat>` Web Component from
[`zulip-embed`](https://github.com/amanagr/zulip-embed) in demo mode.

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

- [`src/App.svelte`](./src/App.svelte) — side-effect-imports
  `zulip-embed/chat` (which calls `customElements.define("zulip-chat", ...)`)
  and then uses the tag like any other DOM element.
- [`src/main.ts`](./src/main.ts) — Svelte 5 runes bootstrap using
  `mount(App, {target})`.
- [`vite.config.ts`](./vite.config.ts) — stock `@sveltejs/vite-plugin-svelte`.

## Svelte and Web Components — zero config

Svelte's compiler treats any unknown tag as a plain DOM element. That
means Web Components like `<zulip-chat>` render natively with no
wrapper, no `isCustomElement` hint, and no noisy dev warnings. This is
a small but real advantage over Vue (which needs two lines in
`vite.config.ts` to suppress an unresolved-component warning) and
React (which needs the `zulip-embed-react` wrapper to forward
camelCase props and CustomEvents idiomatically).

Svelte gets custom-element interop right out of the box because
everything compiles down to direct DOM calls — there's no
framework-specific component registry to miss.

## Connect to a real server

Swap the attributes in `src/App.svelte`:

```svelte
<zulip-chat
    server="https://chat.example.com"
    auth-token="{{ JWT from your backend }}"
    channel="general"
    topic="welcome"
    theme="light"
    mode="inline"
    brand-name="Acme Support"
></zulip-chat>
```

`auth-token` is a JWT minted by your backend — see
[`docs/jwt.md`](../../docs/jwt.md) for the exchange.

## Learn more

- [Top-level `README.md`](../../README.md)
- [Svelte: Using Web Components](https://svelte.dev/docs/svelte/custom-elements)
