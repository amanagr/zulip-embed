---
title: Theming and branding
description: Override --zc-* CSS custom properties, theme="light"/"dark", brand-name/brand-logo, and the tokens map.
---

Every `<zulip-*>` element is a shadow-DOM custom element, so the host
page's CSS doesn't leak in and the embed's CSS doesn't leak out. The
SDK exposes its visual tokens as `--zc-*` CSS custom properties on
`:host` — override them from the host page and the shadow DOM picks
up the new values because CSS variables inherit through the shadow
boundary.

This page is the canonical theming reference. Pair with
[`ARCHITECTURE.md`](https://github.com/amanagr/zulip-embed/blob/main/docs/ARCHITECTURE.md) for the bundle / registration
model, [`events.md`](/reference/events/) for the element surface, and the
live [playground at `demo/index.html`](/#playground)
where every token has a slider and a live copy-paste snippet.

## Quick start

Three lines to retint the accent color:

```css
zulip-chat {
    --zc-color-accent: #ff5722;
}
```

Every button, focus ring, mention chip, link, unread separator, and
streaming cursor shifts to the new hue. The rest of the palette holds
steady — great for "keep our product's look but recolor the embed."

## `theme="light"` / `theme="dark"`

The element ships two curated token sets. Set the attribute to pick:

```html
<zulip-chat theme="light">…</zulip-chat>
<zulip-chat theme="dark">…</zulip-chat>
```

The dark set retints `bg`, `surface`, `border`, `text`, `muted`,
`accent`, and the `syntax-*` palette so code blocks remain readable
against the darker background. The shadow `--zc-shadow-floating`
token also swaps to a heavier drop-shadow for the floating-mode
launcher.

**Auto detection.** v1.0.0 does not auto-detect
`prefers-color-scheme` — the host page decides the theme attribute
explicitly. If you want to track the OS preference, wire it
yourself:

```js
const el = document.querySelector("zulip-chat");
const mq = matchMedia("(prefers-color-scheme: dark)");
const apply = () => el.setAttribute("theme", mq.matches ? "dark" : "light");
apply();
mq.addEventListener("change", apply);
```

We avoid `prefers-color-scheme` inside the component by design —
adopters who embed inside a product that has its own theme toggle
nearly always want to drive that toggle, not the OS. The example
above is three lines when you *do* want OS tracking.

**Embedding inside a dark host page.** If your host page is already
dark and the embed is slotted into a dark card, set `theme="dark"`
explicitly — the element otherwise renders with light tokens and
looks mismatched. The attribute drives a `:host([theme="dark"])`
selector that swaps the full token set in one CSS rule, so the
switch is atomic (no double-paint with half the tokens updated).

## Token reference

All defaults come from [`src/styles.ts`](../src/styles.ts) — treat
that file as the ground truth if the table below and the source
disagree.

### Typography

| Token              | Default                                             | What it controls                                  |
| ------------------ | --------------------------------------------------- | ------------------------------------------------- |
| `--zc-font-family` | `system-ui, -apple-system, "Segoe UI", Roboto, …`  | Base stack for every text node inside the embed   |
| `--zc-font-size`   | `14px`                                              | Root font size; other sizes scale relative to it  |
| `--zc-line-height` | `1.5`                                               | Root line height                                  |

### Sizing and geometry

| Token                  | Default    | What it controls                                       |
| ---------------------- | ---------- | ------------------------------------------------------ |
| `--zc-radius`          | `12px`     | Outer border radius of the chat panel                  |
| `--zc-radius-sm`       | `6px`      | Inner radii (composer, reactions, code blocks, cards)  |
| `--zc-height`          | `560px`    | Default host height (overridable by direct CSS)        |
| `--zc-width`           | `380px`    | Floating-mode panel width                              |
| `--zc-max-height`      | `80vh`     | Upper bound on host height                             |
| `--zc-spacing-xs`      | `4px`      | Tightest spacing unit (reactions, small gaps)          |
| `--zc-spacing-sm`      | `8px`      | Small gaps (icon rows, button gutters)                 |
| `--zc-spacing-md`      | `12px`     | Default gap (messages, composer padding)               |
| `--zc-spacing-lg`      | `16px`     | Outer padding (header, composer footer)                |

### Color palette

| Token                        | Light default | Dark default | What it controls                                               |
| ---------------------------- | ------------- | ------------ | -------------------------------------------------------------- |
| `--zc-color-bg`              | `#ffffff`     | `#111827`    | Primary background of the panel, textarea, message area        |
| `--zc-color-surface`         | `#f7f7f9`     | `#1f2937`    | Secondary background (header, composer wrap, code block, card) |
| `--zc-color-border`          | `#e5e7eb`     | `#374151`    | Hairlines, code-block borders, empty-state chips               |
| `--zc-color-text`            | `#111827`     | `#f9fafb`    | Primary text color                                             |
| `--zc-color-muted`           | `#6b7280`     | `#9ca3af`    | Secondary text (timestamps, hints, placeholder, status)        |
| `--zc-color-accent`          | `#6172f3`     | `#818cf8`    | Brand color — buttons, links, focus rings, cursor, chips       |
| `--zc-color-accent-contrast` | `#ffffff`     | `#ffffff`    | Foreground painted on top of `--zc-color-accent` fills         |
| `--zc-color-error`           | `#dc2626`     | `#dc2626`    | Error banners, destructive actions, disconnect indicator       |
| `--zc-color-success`         | `#16a34a`     | `#16a34a`    | Connected indicator, resolved-topic chip                       |

### Shadows

| Token                   | Light default                           | Dark default                     | What it controls                       |
| ----------------------- | --------------------------------------- | -------------------------------- | -------------------------------------- |
| `--zc-shadow-floating`  | `0 20px 40px rgba(17, 24, 39, 0.18)`    | `0 20px 40px rgba(0, 0, 0, 0.55)`| Drop-shadow on the floating panel     |

### Syntax highlighting

The built-in Pygments-compatible palette paints server-rendered
fenced code blocks. Retint the whole palette by overriding a handful
of variables rather than the per-class selectors:

| Token                    | Light default | Dark default |
| ------------------------ | ------------- | ------------ |
| `--zc-syntax-comment`    | `#6a737d`     | `#8b949e`    |
| `--zc-syntax-keyword`    | `#d73a49`     | `#ff7b72`    |
| `--zc-syntax-string`     | `#032f62`     | `#a5d6ff`    |
| `--zc-syntax-number`     | `#005cc5`     | `#79c0ff`    |
| `--zc-syntax-name`       | `#6f42c1`     | `#d2a8ff`    |
| `--zc-syntax-type`       | `#22863a`     | `#7ee787`    |
| `--zc-syntax-operator`   | `#d73a49`     | `#ff7b72`    |
| `--zc-syntax-builtin`    | `#005cc5`     | `#79c0ff`    |
| `--zc-syntax-error`      | `#b31d28`     | `#ffa198`    |
| `--zc-syntax-punctuation`| inherit       | inherit      |

### Brand logo

| Token                    | Default | What it controls                                     |
| ------------------------ | ------- | ---------------------------------------------------- |
| `--zc-brand-logo-size`   | `24px`  | Width/height of the logo in the header               |
| `--zc-brand-logo-radius` | `6px`   | Border-radius of the logo (square → rounded → pill)  |

## Brand name and logo

Two HTML attributes on `<zulip-chat>` swap the header to product
identity rather than the default `#channel › topic` pair:

```html
<zulip-chat
    server="https://acme.zulipchat.com"
    auth-token="<JWT>"
    channel="support"
    brand-name="Acme Support"
    brand-logo="https://acme.example/logo.svg"
></zulip-chat>
```

- **`brand-name`** — replaces the header text. When set, the default
  `#` prefix glyph is suppressed (the header reads "Acme Support"
  instead of "#Acme Support").
- **`brand-logo`** — URL to an image shown next to the brand name.
  **Only `http:`, `https:`, and relative paths are accepted.**
  `javascript:` / `data:` / protocol-relative URIs are rejected at
  parse time — the logo silently stays hidden. This is enforced by
  `sanitizeBrandLogoUrl` in `src/component.ts`; the same rule applies
  to avatar URLs inside `MessagePartAuthor.avatarUrl`.

The logo size and radius are controlled by the two
`--zc-brand-logo-*` tokens above — useful when your logo is a square
icon and you want it pill-shaped, or vice versa.

## Per-element theming

Every `<zulip-*>` element declares its own `:host` defaults, and
every element reads the same `--zc-*` token names. So one rule block
on the host page retints the whole family consistently:

```css
zulip-chat,
zulip-channel-list,
zulip-topic-list,
zulip-dm-list,
zulip-announcement {
    --zc-color-accent: #5f3dc4;
    --zc-color-bg: #ffffff;
    --zc-font-family: "Inter", system-ui, sans-serif;
    --zc-radius: 10px;
}
```

Per-element highlights:

### `<zulip-chat>`

The busiest surface — composer, feed, reactions, tool cards,
confirmation widgets. Every token in the table above applies.
Streaming-agent messages get a blinking caret painted with
`currentColor`, so retinting `--zc-color-text` moves it automatically.

### `<zulip-channel-list>` and `<zulip-topic-list>`

Light sidebars. Unread counts use `--zc-color-accent` on a muted
surface; resolved-topic chips use `--zc-color-success`. The topic
list's secondary row is painted with `--zc-color-muted`.

### `<zulip-dm-list>`

Direct-message conversation picker. Uses the same palette as the
channel list, but group-DM bubbles show initials on a
`--zc-color-accent` tint.

### `<zulip-announcement>`

The pinned-message banner ships with a distinct indigo default set
(`#f5f3ff` bg / `#ddd6fe` border) so it stands apart from surrounding
product chrome. All of `--zc-color-bg`, `--zc-color-border`,
`--zc-color-text`, `--zc-color-muted`, and `--zc-color-accent`
override cleanly if you want it to match the rest of your theme.

## Compose, emoji picker, reactions, confirmation

All four sub-components render inside the `<zulip-chat>` shadow root
and inherit the base palette. A few overrides worth knowing:

**Composer.** The textarea sits on `--zc-color-bg` so it contrasts
against the `--zc-color-surface` wrapper around it. If you flatten
both to the same color, the textarea becomes invisible until focused
— retint one of them to keep the contrast.

**Emoji picker.** Opens as a floating card anchored to the trigger
button. Background defaults to `--zc-color-bg` with a heavier drop
shadow. The category strip is drawn with `--zc-color-muted` and the
search input sits on `--zc-color-surface`.

**Reactions.** Pill buttons, border-colored with `--zc-color-border`
and filled with `--zc-color-surface`. The viewer's own reactions are
tinted with a 16% `--zc-color-accent` blend — retinting the accent
flows through automatically.

**Tool-call cards.** Render with a thin left accent bar painted from
the per-part `MessagePartAuthor.color` (when supplied) or
`--zc-color-border` otherwise. Paired tool-result blocks pick up
`--zc-color-error` when `isError: true`.

**Confirmation widget.** Card background is `--zc-color-surface`;
the Approve button fills with `--zc-color-accent` + text in
`--zc-color-accent-contrast`; the Deny button inherits neutral
colors. Keeps the widget recognizable as a "decision point" without
extra theming.

## Using the live playground

The demo site hosts an interactive playground that walks every
token:

> <https://amanagr.github.io/zulip-embed/#playground>

Tweak the sliders, watch the embed re-paint live, then click **Copy
snippet** to get a ready-to-paste `zulip-chat { … }` rule block.
The playground source lives at
[`demo/index.html`](../demo/index.html) + [`demo/main.ts`](../demo/main.ts)
in this repo; it's the fastest way to iterate on a theme before
locking it into your product.

## Full example — brand match

A complete theme block that makes the embed read as a product
component rather than a bolted-on chat:

```css
.chat-card zulip-chat {
    /* Typography */
    --zc-font-family: "Inter", system-ui, sans-serif;
    --zc-font-size: 13px;

    /* Geometry */
    --zc-radius: 14px;
    --zc-radius-sm: 8px;
    --zc-height: 520px;

    /* Palette — matches our product's primary brand */
    --zc-color-bg: #ffffff;
    --zc-color-surface: #f5f4fb;
    --zc-color-border: #e1dfe8;
    --zc-color-text: #1b1530;
    --zc-color-muted: #6b6380;
    --zc-color-accent: #7b4dff;
    --zc-color-accent-contrast: #ffffff;

    /* Brand logo */
    --zc-brand-logo-size: 28px;
    --zc-brand-logo-radius: 8px;
}
```

Dark mode override:

```css
[data-theme="dark"] .chat-card zulip-chat {
    --zc-color-bg: #0d0920;
    --zc-color-surface: #181234;
    --zc-color-border: #2a214c;
    --zc-color-text: #f5f3ff;
    --zc-color-muted: #a99fc7;
    --zc-color-accent: #b89bff;
}
```

Pair this with `<zulip-chat theme="dark">` so the component's own
`:host([theme="dark"])` selector applies (it swaps syntax-highlight
palette + floating-shadow alongside the variables above).

## Pitfalls

**Unset variables fall back to SDK defaults.** A token left
unassigned picks up its `:host` default from `src/styles.ts`. You
don't need to override every variable — just the ones you want to
change. The only exception: `--zc-brand-logo-size` and
`--zc-brand-logo-radius` have inline fallbacks inside the stylesheet
(`var(--zc-brand-logo-size, 24px)`), so they also work if you never
mention them.

**CSS specificity against the shadow DOM.** Host-page selectors
can't target internal elements like `.composer-input` or
`.reaction`. The shadow root is a boundary — the only styling hooks
are the `--zc-*` custom properties and the `theme=` /
`brand-*` attributes on the host element. If you find yourself
wanting to restyle the composer's textarea directly, that's a signal
to open a GitHub issue for a new token rather than forking the
component.

**Custom-property inheritance is all-or-nothing.** Setting
`--zc-color-accent` on `body` inherits into `<zulip-chat>` just fine,
but setting it on a sibling of `<zulip-chat>` does not — CSS custom
properties inherit down the DOM tree, not across it. Put your theme
block on an ancestor of the embed element.

**Font loading race conditions.** If your `--zc-font-family` references
a web font loaded via `@font-face`, the first render draws with the
fallback stack until the font arrives. Either:

1. Set `font-display: swap` on your `@font-face` rule (default in
   most CDN-served fonts), or
2. Preload the font with
   `<link rel="preload" as="font" href="…" crossorigin>` so it lands
   before the shadow root paints.

Without one of these, users see a ~100-300 ms flash of the fallback
family, especially on cold cache.

**`theme` attribute vs. CSS variable overrides.** The `theme="dark"`
attribute sets a block of variables via
`:host([theme="dark"]) { --zc-color-bg: …; }`. Host-page overrides
have the same specificity as the built-in rule but higher source
order, so they win for variables they touch. Combine them:
`theme="dark"` establishes the baseline dark palette, then a more
specific host rule recolors the accent.

**Empty `brand-logo` URL silently hides the logo.** If your server
sometimes renders the attribute as an empty string (`brand-logo=""`),
the component treats it as "no logo" rather than logging an error.
Check your templating layer if the logo mysteriously disappears
after deploy.

**Shadow-DOM-safe unit of change.** Always scope the override to the
specific element (`zulip-chat { … }`) rather than `*` or the
document root — even though CSS vars inherit, scoping keeps the
overrides auditable from `devtools → Computed → Inherited` when
someone else reads your CSS two months later.

## Further reading

- [`docs/ARCHITECTURE.md`](https://github.com/amanagr/zulip-embed/blob/main/docs/ARCHITECTURE.md) — shadow-DOM isolation
  model, why `--zc-*` is the only hook.
- [`docs/events.md`](/reference/events/) — widget events fired from inside
  the shadow root (confirmation, channel/topic selection).
- [`src/styles.ts`](../src/styles.ts) — authoritative token list and
  defaults.
- [`demo/index.html`](../demo/index.html) — source of the live
  playground.
