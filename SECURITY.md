# Security model

This document summarizes the threats the embed defends against, what it
**cannot** defend against, and how to report issues.

## Reporting a vulnerability

Please email security reports to `security@zulip.com` — do **not** open a
public GitHub issue for anything potentially exploitable. We'll acknowledge
within 72 hours and work with you on disclosure timing.

## Threat model at a glance

| Surface | Threat | Mitigation |
| --- | --- | --- |
| Zulip message HTML | Stored XSS via rendered content | DOMPurify with strict allow-list (tags, attributes, URI scheme); hrefs forced `rel="noopener noreferrer nofollow ugc"`; images served `referrerpolicy="no-referrer"` |
| Avatars & inline uploads | SSRF / `javascript:` / `data:` URLs | `resolveUrl` rejects every scheme except `http`, `https`, `mailto` before the DOM sees it |
| Component config | XSS via attributes (`channel`, `topic`) | All attribute reads flow through `textContent` / DOM API setters — never `innerHTML` |
| Transport | Plaintext credential exfiltration | `serverUrl` validated to `http(s)` only; `http://` against non-loopback hosts emits a console warning |
| Credential storage | API key visible in DOM | **Not mitigated** — see "Out of scope" |
| Third-party script tags | Tampered `zulip-embed` bundle | Publish with SRI-friendly unpkg URLs (roadmap: sign releases) |
| Flutter transport | Same class of issues as web | `_normalize()` validates scheme; HTTP Basic built from UTF-8 bytes |

## What the sanitizer accepts

The allow-list in `src/render.ts` covers every HTML tag Zulip's server
markdown renderer emits today: headings, paragraphs, lists, tables,
blockquotes, inline code, code blocks, images, mentions, channel
references, keyboard marks, and basic inline formatting. It rejects
`<script>`, `<iframe>`, `<form>`, `<object>`, `<embed>`, `<input>`,
`<style>`, inline event handlers (`onclick`, `onerror`, etc.), `style`
attributes, and unknown URI schemes.

Server-side Zulip also sanitizes on save, so this is defense in depth: the
embed assumes nothing about the trustworthiness of the HTML it receives.

## URL handling

- **Anchors**: `href` must parse as `http:`, `https:`, or `mailto:`.
  Anything else (including `javascript:`, `data:`, `vbscript:`, relative
  refs to unknown schemes) is stripped. Every surviving anchor gets
  `target="_blank"` + `rel="noopener noreferrer nofollow ugc"`.
- **Images**: `src` must parse as `http:` or `https:` after resolving
  relative paths against the configured Zulip `serverUrl`. Unsafe URLs
  cause the `<img>` element to be removed rather than left with a broken
  `src`. `loading="lazy"`, `decoding="async"`, and
  `referrerpolicy="no-referrer"` are applied to prevent referrer leakage
  to upload CDNs.
- **Plain-text autolinking**: The regex only matches `https?://…` spans,
  and the resulting `<a>` is double-checked with `isSafeHttpUrl` before
  `href` is set.

## Credential handling

The Web Component exposes API credentials as HTML attributes
(`server`, `email`, `api-key`). This is convenient for low-privilege
bot-account integrations, but it means:

- **Any script on the host page can read them.** Do not pass personal
  Zulip credentials — provision a dedicated bot account per embed with
  access only to the channels it needs.
- **Credentials leave your page only in the Authorization header on
  requests to `serverUrl`.** We refuse to ship them to anything other than
  `http(s)://` (Flutter package enforces the same rule) and warn when the
  URL is non-loopback HTTP.
- **Credentials are never logged, never cached in `localStorage`, and
  never serialized back into DOM.**

The headless SDK (`new ZulipClient({transport: new ZulipTransport(...)})`)
lets integrators keep the API key in memory only and pass it in via JS,
avoiding the DOM-attribute exposure entirely. Prefer that route for any
deployment where the host page runs untrusted third-party script.

## Snapshot mode

`snapshot-url` mode loads a pre-fetched JSON payload instead of opening a
live event queue, so **no credentials travel to the browser**. The
tradeoffs:

- The snapshot JSON is trusted to the same level as the Zulip server
  that produced it — every `content` field passes through the same
  DOMPurify allow-list as live messages.
- `snapshot-url` is validated against a scheme allow-list (`http`, `https`,
  or same-origin relative path). `javascript:`, `data:`, `file:`, and
  protocol-relative `//host` URLs are rejected before `fetch` is called.
- `scripts/fetch-announce-snapshot.mjs` runs in CI with bot credentials
  and writes JSON into the repo. The write path is resolved against the
  repo root and refuses to escape it, so a poisoned `ZULIP_ANNOUNCE_OUT`
  env var can't overwrite arbitrary files on the runner.
- The bot must be a **generic** Zulip bot — incoming-webhook bots return
  HTTP 401 on `/api/v1/messages`. See `README.md` for the setup notes.

## Out of scope

- **Host-page XSS**: if the page embedding `<zulip-chat>` is already
  compromised, the attacker can read attributes, intercept fetches, and
  do anything the user can do. Use CSP and avoid embedding on pages that
  render untrusted third-party HTML.
- **MITM on HTTP**: The warning about `http://` is advisory. Deploy TLS.
- **Zulip server compromise**: The sanitizer defends against bad HTML on
  the wire; it does not defend against a malicious server forging
  messages. If the server is hostile, the whole session is hostile.
- **Custom emoji served from non-Zulip origins**: Allowed only if the
  origin uses `https`. Embedders who pipe images from other origins are
  responsible for those origins.
