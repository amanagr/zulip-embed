# vue

A minimal [Vite](https://vitejs.dev/) + Vue 3 app that mounts the
framework-agnostic `<zulip-chat>` Web Component from
[`zulip-embed`](https://www.npmjs.com/package/zulip-embed) in demo mode.

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

- [`src/App.vue`](./src/App.vue) — a Single File Component that
  side-effect-imports `zulip-embed/chat` (which calls
  `customElements.define("zulip-chat", ...)`) and then renders the
  element like any other tag.
- [`src/main.ts`](./src/main.ts) — standard `createApp(App).mount()`.
- [`vite.config.ts`](./vite.config.ts) — Vue plugin with the optional
  `isCustomElement` flag (see below).

## Vue and Web Components

Vue's template compiler by default assumes every lowercase tag it
doesn't recognise is a Vue component, and logs a warning when it can't
resolve one. The component still renders correctly — Vue falls back to
emitting plain DOM for unknown tags — but the dev console fills with
"Failed to resolve component: zulip-chat" noise.

The fix is two lines in `vite.config.ts`:

```ts
vue({
    template: {
        compilerOptions: {
            isCustomElement: (tag) => tag.startsWith("zulip-"),
        },
    },
});
```

That tells Vue to treat any `zulip-*` tag as a native Custom Element
and skip resolution. Optional but recommended.

## Connect to a real server

Swap the attributes in `src/App.vue`:

```vue
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
- [Vue: Using Vue with Web Components](https://vuejs.org/guide/extras/web-components.html)
