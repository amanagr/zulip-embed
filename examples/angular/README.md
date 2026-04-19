# angular

A minimal [Vite](https://vitejs.dev/) + Angular 18 (standalone-component)
app that mounts the framework-agnostic `<zulip-chat>` Web Component from
[`zulip-embed`](https://github.com/amanagr/zulip-embed) in demo mode.

Vite drives the build via
[`@analogjs/vite-plugin-angular`](https://www.npmjs.com/package/@analogjs/vite-plugin-angular),
so the example stays structurally identical to the other Vite-based
examples in this folder (`vue/`, `svelte/`, `react/`) — same `dev`,
`build`, `preview` scripts, no `@angular/cli` / webpack.

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

- [`src/app/app.component.ts`](./src/app/app.component.ts) — a
  standalone component whose template renders `<zulip-chat demo>`. It
  sets `schemas: [CUSTOM_ELEMENTS_SCHEMA]` so Angular's template
  compiler accepts the unknown tag (see below).
- [`src/main.ts`](./src/main.ts) — imports `zone.js`, side-effect-
  imports `zulip-embed/chat` (which calls
  `customElements.define("zulip-chat", ...)`), then
  `bootstrapApplication(AppComponent)`.
- [`vite.config.ts`](./vite.config.ts) — loads the Analog plugin as the
  first entry in `plugins`.
- [`tsconfig.json`](./tsconfig.json) /
  [`tsconfig.app.json`](./tsconfig.app.json) — strict Angular settings
  plus the `angularCompilerOptions` block Angular's compiler expects.

## Angular and Web Components — the `CUSTOM_ELEMENTS_SCHEMA` hook

Angular's template compiler is stricter than Vue's or Svelte's: it
treats unknown element tags as a **hard error** during compilation, not
a warning. Without any hint, the compiler rejects a template containing
`<zulip-chat>` with:

```
NG8001: 'zulip-chat' is not a known element
```

The fix is one import and one line of component metadata:

```ts
import {Component, CUSTOM_ELEMENTS_SCHEMA} from "@angular/core";

@Component({
    selector: "app-root",
    standalone: true,
    schemas: [CUSTOM_ELEMENTS_SCHEMA],
    template: `<zulip-chat demo channel="general" topic="welcome"></zulip-chat>`,
})
export class AppComponent {}
```

`CUSTOM_ELEMENTS_SCHEMA` tells Angular "any tag containing a dash is a
Custom Element — pass it through to the DOM unchanged, don't try to
resolve it as an Angular component or directive." You apply it on
each component whose template hosts Web Components.

### How this compares to the other framework examples

| Framework   | What you do                                                                      |
| ----------- | -------------------------------------------------------------------------------- |
| **Angular** | Add `schemas: [CUSTOM_ELEMENTS_SCHEMA]` to each component that hosts `<zulip-*>` |
| **Vue**     | Set `isCustomElement: tag => tag.startsWith("zulip-")` on the template compiler  |
| **React**   | Use the [`zulip-embed-react`](../react/) wrapper (for camelCase props + events)  |
| **Svelte**  | Nothing — unknown tags are plain DOM by default                                  |

All four end up calling the same underlying `<zulip-chat>` element; the
difference is only in how the framework's template compiler needs to be
told the tag is intentional.

## Connect to a real server

Swap the attributes in `src/app/app.component.ts`:

```html
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
- [Angular: Schemas and Custom Elements](https://angular.dev/api/core/CUSTOM_ELEMENTS_SCHEMA)
- [AnalogJS — Vite plugin for Angular](https://analogjs.org/docs/packages/vite-plugin-angular/overview)
