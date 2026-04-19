# Security policy

This document summarizes the threats the embed defends against, what it
**cannot** defend against, and how to report issues.

## Reporting a vulnerability

Please email security reports to **`security@zulip.com`** — do **not**
open a public GitHub issue for anything potentially exploitable. This
is the standing security mailbox for the Zulip project, and the Zulip
Embed SDK reuses it: the Zulip maintainers triage embed reports from
the same queue as Zulip server reports.

When you file a report, please include:

- Affected version(s) of `zulip-embed` (or the `zulip_embed` Flutter
  package, `zulip-embed-react`, `zulip-embed-react-native`).
- A minimal reproduction — a snippet, URL, or attached HTML/Dart file
  is ideal. For sanitizer bypasses, paste the offending markdown.
- Observed vs. expected behavior, and — if you know — the class of
  issue (XSS, credential leak, SSRF, etc.).
- Whether you'd like public credit after the fix ships; we default to
  crediting reporters in the CHANGELOG unless you ask otherwise.

### Response expectations

| Stage                             | Target                                |
| --------------------------------- | ------------------------------------- |
| Acknowledge receipt               | within **72 hours**                   |
| Initial triage + severity call    | within **7 days**                     |
| Patch shipped — critical severity | within **30 days** of acknowledgement |
| Patch shipped — other severities  | within **90 days** of acknowledgement |

"Critical" means something like unauthenticated XSS from default
Zulip-rendered content, credential exfiltration, or a sanitizer bypass
that fires without user interaction. Everything else is lower-severity
by default; we'll tell you which bucket we've assigned and why.

If we miss a target we'll say so, explain the blocker, and propose a
new date — we won't quietly run the clock out.

## Scope

### In scope (treat as a vulnerability and report privately)

- Stored or reflected XSS via Zulip markdown, sanitizer bypasses,
  missed allow-list entries in `src/render.ts`, or attribute-reflection
  injection into `<zulip-chat>` and siblings.
- Credential leaks — API keys, auth tokens, JWTs, or bot passwords
  escaping into `localStorage`, `sessionStorage`, IndexedDB, logs,
  query strings, `Referer` headers, or error messages.
- Subresource Integrity (SRI) desync between
  `dist/INTEGRITY.{json,md}` and the bytes actually published to npm /
  unpkg.
- SSRF or unsafe URL dereferencing via `resolveUrl`, `snapshot-url`,
  avatar / inline-upload fetches, or the Flutter transport's
  `_normalize()` path.
- Any way to upgrade a plain-text `http://` connection into a silent
  credential-exfil channel without the existing console warning
  firing.
- Same-origin bypasses of `snapshot-url` scheme validation, or
  path-escape bugs in `scripts/fetch-announce-snapshot.mjs`.

### Not a vulnerability (file as a normal bug or feature request)

- Feature requests and missing functionality.
- Client-side DoS from adversarial markdown that renders slowly or
  inflates the DOM — we treat this as a rendering bug (file an issue),
  not a security report.
- Issues that only reproduce against Zulip servers older than the
  oldest version this SDK officially supports.
- Anything under **Out of scope** in the threat model below (host-page
  XSS, MITM on `http://`, malicious Zulip server, custom-emoji origins
  the embedder wires up themselves).
- Automated scanner output without a working proof-of-concept. We're
  happy to look at real findings, but raw Nessus / Burp exports with
  no analysis aren't actionable.

## Disclosure policy

We practice **coordinated disclosure**:

1. You report privately to `security@zulip.com`. We acknowledge and
   triage per the table above.
2. We develop and test a fix on a private branch. You're welcome to
   review candidate patches; we'll share them once they're ready.
3. We ship the fix in a patched release on the latest supported minor
   (and backport to the previous minor if it's still in the support
   window — see below).
4. We run `npm deprecate` against the vulnerable version range with a
   short message pointing at the fixed version, so `npm install`
   surfaces the warning to anyone still on an affected release. The
   Flutter package uses `pub.dev` retraction for the same purpose.
5. We request or assign a **CVE** once the fix ships (or sooner, if
   coordination with downstream distributors needs it), publish a
   GitHub Security Advisory, and update `CHANGELOG.md` with the
   affected range, the fix, and reporter credit.
6. Public write-ups, blog posts, and conference talks are welcome
   after the advisory goes public. Please coordinate timing with us
   before the advisory is published.

If a vulnerability is already being exploited in the wild or has been
publicly disclosed by someone else, we'll compress the timeline and
ship as fast as we safely can.

## Supported versions

We support **the latest minor release line** with feature updates and
security patches, and the **previous minor** with security patches
only for 90 days after a new minor ships. Anything older is
unsupported — please upgrade.

| Version line       | Status                                                | Security patches |
| ------------------ | ----------------------------------------------------- | ---------------- |
| `1.x` (latest)     | Supported — features, fixes, security patches         | Yes              |
| `0.8.x` (previous) | Security patches only, until 90 days after `1.0`'s GA | Yes              |
| `< 0.8`            | Unsupported                                           | No               |

Until `1.0` ships, `0.8.x` is the "latest" line and the pre-1.0
releases before it (`0.7` and earlier) are unsupported. Once `1.0`
ships, the table above takes effect.

The React, React Native, and Flutter packages follow the same version
line as the core `zulip-embed` package they ship against — a security
fix in `zulip-embed@1.2.3` is released alongside matching package
updates where applicable.

## Threat model at a glance

| Surface                  | Threat                                  | Mitigation                                                                                                                                                           |
| ------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zulip message HTML       | Stored XSS via rendered content         | DOMPurify with strict allow-list (tags, attributes, URI scheme); hrefs forced `rel="noopener noreferrer nofollow ugc"`; images served `referrerpolicy="no-referrer"` |
| Avatars & inline uploads | SSRF / `javascript:` / `data:` URLs     | `resolveUrl` rejects every scheme except `http`, `https`, `mailto` before the DOM sees it                                                                            |
| Component config         | XSS via attributes (`channel`, `topic`) | All attribute reads flow through `textContent` / DOM API setters — never `innerHTML`                                                                                 |
| Transport                | Plaintext credential exfiltration       | `serverUrl` validated to `http(s)` only; `http://` against non-loopback hosts emits a console warning                                                                |
| Credential storage       | API key visible in DOM                  | **Not mitigated** — see "Out of scope"                                                                                                                               |
| Third-party script tags  | Tampered `zulip-embed` bundle           | Publish with SRI-friendly unpkg URLs (roadmap: sign releases)                                                                                                        |
| Flutter transport        | Same class of issues as web             | `_normalize()` validates scheme; HTTP Basic built from UTF-8 bytes                                                                                                   |

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
